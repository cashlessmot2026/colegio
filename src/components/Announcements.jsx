import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase, q, upload, signedUrl } from '../lib/supabase.js';
import { useAuth } from '../context.jsx';
import { fmtDate, fmtDateTime } from '../lib/dates.js';
import { Card, GlowButton, Empty, Spinner, Field, Stagger, StaggerItem, useToast } from './ui.jsx';

export const ANN_KIND = {
  cierre: { label: 'Cierre del colegio', icon: '🏫', cls: 'bad' },
  actividad: { label: 'Actividad', icon: '📅', cls: 'info' },
  publicidad: { label: 'Publicidad', icon: '📣', cls: 'warn' },
  general: { label: 'Comunicado', icon: '📢', cls: '' },
};
const ROLES = [['student', '🎒 Estudiantes'], ['parent', '👨‍👩‍👧 Padres'], ['teacher', '🧑‍🏫 Profesores'], ['guard', '🛡️ Vigilancia']];

// imágenes en bucket privado → URLs firmadas
function useImageUrls(images) {
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    let alive = true;
    Promise.all((images || []).map((i) => signedUrl('colegio-comunicados', i.path).catch(() => null))).then((u) => alive && setUrls(u.filter(Boolean)));
    return () => { alive = false; };
  }, [JSON.stringify(images)]); // eslint-disable-line
  return urls;
}

function Carousel({ images }) {
  const urls = useImageUrls(images);
  const [i, setI] = useState(0);
  useEffect(() => { if (urls.length < 2) return; const t = setInterval(() => setI((x) => (x + 1) % urls.length), 4500); return () => clearInterval(t); }, [urls.length]);
  if (!urls.length) return null;
  return (
    <div className="ann-media">
      <AnimatePresence mode="wait">
        <motion.img key={i} src={urls[i]} alt="" initial={{ opacity: 0, scale: 1.06 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} />
      </AnimatePresence>
      {urls.length > 1 && <div className="ann-dots">{urls.map((_, k) => <button key={k} className={k === i ? 'on' : ''} onClick={() => setI(k)} aria-label={`Imagen ${k + 1}`} />)}</div>}
    </div>
  );
}

export function AnnouncementCard({ a, onDelete }) {
  const k = ANN_KIND[a.kind] || ANN_KIND.general;
  const promo = a.kind === 'publicidad';
  return (
    <motion.div className={`card ann ${promo ? 'promo' : ''} ${a.kind === 'cierre' ? 'closing' : ''}`} whileHover={{ y: -4 }} layout>
      <Carousel images={a.images} />
      <div className="row" style={{ marginBottom: 6 }}>
        <span className={`badge ${k.cls}`}>{k.icon} {k.label}</span>
        {a.event_date && <span className="badge">📆 {fmtDate(a.event_date)}</span>}
        <span className="spacer" /><span className="small muted">{fmtDateTime(a.created_at)}</span>
      </div>
      <h3 style={promo ? { fontSize: '1.35rem' } : undefined} className={promo ? 'grad-text' : ''}>{a.title}</h3>
      {a.body && <p style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{a.body}</p>}
      {a.links?.length > 0 && (
        <div className="row" style={{ marginTop: 10 }}>
          {a.links.map((l, i) => <a key={i} className="gbtn sm" href={l.url} target="_blank" rel="noopener noreferrer">🔗 {l.label || 'Abrir enlace'}</a>)}
        </div>
      )}
      {onDelete && (
        <div className="row" style={{ marginTop: 12 }}>
          <span className="small muted">Para: {a.roles.map((r) => ROLES.find((x) => x[0] === r)?.[1]).join(', ')}</span>
          <span className="spacer" /><GlowButton size="sm" variant="bad" onClick={() => onDelete(a)}>Eliminar</GlowButton>
        </div>
      )}
    </motion.div>
  );
}

// Lista de avisos para padres, estudiantes, docentes y vigilancia
export function AnnouncementsFeed({ limit }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    q(supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(limit || 50)).then(setList).catch(() => setList([]));
    const ch = supabase.channel('ann-feed').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, ({ new: a }) => setList((x) => [a, ...(x || [])])).subscribe();
    return () => supabase.removeChannel(ch);
  }, [limit]);
  if (!list) return <Spinner />;
  if (!list.length) return limit ? null : <Empty icon="📢">No hay comunicados del colegio</Empty>;
  return <Stagger className="grid g2">{list.map((a) => <StaggerItem key={a.id}><AnnouncementCard a={a} /></StaggerItem>)}</Stagger>;
}

// Panel del colegio: redactar y enviar
export function AdminAnnouncements() {
  const { profile } = useAuth();
  const toast = useToast();
  const empty = { title: '', body: '', kind: 'general', event_date: '', roles: ['student', 'parent', 'teacher'], links: [] };
  const [f, setF] = useState(empty);
  const [files, setFiles] = useState([]);
  const [link, setLink] = useState({ label: '', url: '' });
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(null);
  const load = () => q(supabase.from('announcements').select('*').order('created_at', { ascending: false })).then(setList);
  useEffect(() => { load(); }, []);

  const allSel = ROLES.every(([r]) => f.roles.includes(r));
  const toggleRole = (r) => setF({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] });
  const addLink = () => {
    if (!/^https?:\/\//i.test(link.url)) return toast(new Error('El enlace debe empezar por http:// o https://'));
    setF({ ...f, links: [...f.links, link] }); setLink({ label: '', url: '' });
  };
  const send = async (e) => {
    e.preventDefault();
    if (!f.roles.length) return toast(new Error('Seleccione al menos un perfil destinatario'));
    setBusy(true);
    try {
      const images = [];
      for (const file of files) images.push(await upload('colegio-comunicados', file));
      await q(supabase.from('announcements').insert({ ...f, event_date: f.event_date || null, images, created_by: profile.id }));
      toast('Comunicado enviado: los destinatarios recibirán una notificación');
      setF(empty); setFiles([]); e.target.reset(); load();
    } catch (err) { toast(err); } finally { setBusy(false); }
  };
  const del = async (a) => {
    if (!window.confirm('¿Eliminar este comunicado?')) return;
    if (a.images?.length) await supabase.storage.from('colegio-comunicados').remove(a.images.map((i) => i.path));
    await supabase.from('announcements').delete().eq('id', a.id); load();
  };
  const previews = files.map((fl) => URL.createObjectURL(fl));

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card glow title="Nuevo comunicado">
        <form className="form" onSubmit={send}>
          <Field label="Tipo">
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {Object.entries(ANN_KIND).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </Field>
          <Field label={f.kind === 'cierre' ? 'Día(s) de cierre' : 'Fecha del evento (opcional)'}><input type="date" value={f.event_date} onChange={(e) => setF({ ...f, event_date: e.target.value })} /></Field>
          <Field label="Título" className="full"><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={f.kind === 'cierre' ? 'No habrá clases el viernes por jornada pedagógica' : 'Título del comunicado'} /></Field>
          <Field label="Mensaje" className="full"><textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <div className="full col" style={{ gap: 8 }}>
            <span className="small muted">Enviar a (selección múltiple):</span>
            <div className="row">
              <motion.button type="button" whileTap={{ scale: 0.92 }} className={`gbtn sm ${allSel ? 'solid' : 'ghost'}`} onClick={() => setF({ ...f, roles: allSel ? [] : ROLES.map((r) => r[0]) })}>🌐 Todos</motion.button>
              {ROLES.map(([r, l]) => <motion.button type="button" key={r} whileTap={{ scale: 0.92 }} className={`gbtn sm ${f.roles.includes(r) ? 'solid' : 'ghost'}`} onClick={() => toggleRole(r)}>{f.roles.includes(r) ? '✓ ' : ''}{l}</motion.button>)}
            </div>
          </div>
          <Field label="Imágenes (afiche, publicidad…)" className="full"><input type="file" accept="image/*" multiple onChange={(e) => setFiles([...e.target.files].slice(0, 6))} /></Field>
          {previews.length > 0 && <div className="full row">{previews.map((u, i) => <motion.img key={u} src={u} alt="" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: i * 0.05 }} style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--line)' }} />)}</div>}
          <div className="full col" style={{ gap: 6 }}>
            <span className="small muted">Enlaces</span>
            {f.links.map((l, i) => <div key={i} className="row small"><span>🔗 {l.label || l.url}</span><span className="muted">{l.url}</span><button type="button" className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => setF({ ...f, links: f.links.filter((_, j) => j !== i) })}>✕</button></div>)}
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input placeholder="Texto del botón" value={link.label} onChange={(e) => setLink({ ...link, label: e.target.value })} style={{ maxWidth: 200 }} />
              <input placeholder="https://…" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} />
              <GlowButton type="button" size="sm" onClick={addLink} disabled={!link.url}>＋</GlowButton>
            </div>
          </div>
          <div className="full row" style={{ justifyContent: 'flex-end' }}><GlowButton variant="solid" size="lg" type="submit" disabled={busy}>{busy ? 'Enviando…' : '📤 Enviar comunicado'}</GlowButton></div>
        </form>
      </Card>
      <h3>Enviados</h3>
      {!list ? <Spinner /> : !list.length ? <Empty icon="📢">Aún no hay comunicados</Empty> : (
        <Stagger className="grid g2">{list.map((a) => <StaggerItem key={a.id}><AnnouncementCard a={a} onDelete={del} /></StaggerItem>)}</Stagger>
      )}
    </div>
  );
}
