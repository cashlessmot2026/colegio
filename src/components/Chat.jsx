import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase, q, rpc, upload, openFile } from '../lib/supabase.js';
import { useAuth } from '../context.jsx';
import { Avatar, GlowButton, Spinner, Empty, useToast } from './ui.jsx';

const ROLE = { admin: 'Colegio', teacher: 'Docente', parent: 'Acudiente', student: 'Estudiante', guard: 'Vigilancia' };
const hhmm = (d) => new Date(d).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

// Chat privado estilo WhatsApp. Los contactos permitidos los decide la base de datos (my_contacts).
export default function Chat() {
  const { profile } = useAuth();
  const toast = useToast();
  const [contacts, setContacts] = useState(null);
  const [all, setAll] = useState([]);
  const [peer, setPeer] = useState(null);
  const [filter, setFilter] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  const fileRef = useRef(null);
  const me = profile.id;

  useEffect(() => {
    rpc('cg_my_contacts').then(setContacts).catch((e) => { toast(e); setContacts([]); });
    q(supabase.from('messages').select('*').or(`from_id.eq.${me},to_id.eq.${me}`).order('created_at').limit(2000)).then(setAll).catch(() => {});
    const ch = supabase.channel(`chat-${me}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `to_id=eq.${me}` }, ({ new: m }) => setAll((x) => [...x, m]))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `from_id=eq.${me}` }, ({ new: m }) => setAll((x) => x.map((i) => (i.id === m.id ? m : i))))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [me, toast]);

  // conversaciones ordenadas por último mensaje
  const convs = useMemo(() => {
    if (!contacts) return [];
    const map = new Map(contacts.map((c) => [c.id, { ...c, last: null, unread: 0 }]));
    for (const m of all) {
      const other = m.from_id === me ? m.to_id : m.from_id;
      const c = map.get(other);
      if (!c) continue;
      c.last = m;
      if (m.to_id === me && !m.read_at) c.unread++;
    }
    return [...map.values()]
      .filter((c) => (c.full_name + ' ' + (c.detail || '')).toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => (b.last?.created_at || '').localeCompare(a.last?.created_at || '') || a.full_name.localeCompare(b.full_name));
  }, [contacts, all, me, filter]);

  const thread = useMemo(() => peer ? all.filter((m) => (m.from_id === me && m.to_id === peer.id) || (m.to_id === me && m.from_id === peer.id)) : [], [all, peer, me]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (!peer) return;
    const unread = thread.filter((m) => m.to_id === me && !m.read_at).map((m) => m.id);
    if (unread.length) {
      const now = new Date().toISOString();
      supabase.from('messages').update({ read_at: now }).in('id', unread).then(() =>
        setAll((x) => x.map((m) => (unread.includes(m.id) ? { ...m, read_at: now } : m))));
    }
  }, [thread.length, peer, me]); // eslint-disable-line

  const send = async (e, file) => {
    e?.preventDefault();
    if (!peer || (!text.trim() && !file)) return;
    setSending(true);
    try {
      let f = null;
      if (file) f = await upload('colegio-chat', file, me);
      const row = await q(supabase.from('messages').insert({ from_id: me, to_id: peer.id, body: text.trim() || null, file_path: f?.path, file_name: f?.name }).select().single());
      setAll((x) => [...x, row]); setText('');
    } catch (err) { toast(err); } finally { setSending(false); }
  };

  if (!contacts) return <Spinner />;
  let lastDay = '';
  return (
    <div className={`chat ${peer ? 'open' : ''}`}>
      <div className="chat-list">
        <div className="search"><input placeholder="🔎 Buscar contacto…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <div className="chat-items">
          {convs.length === 0 && <Empty icon="💬">No hay contactos disponibles</Empty>}
          {convs.map((c) => (
            <motion.div layout key={c.id} className={`chat-item ${peer?.id === c.id ? 'active' : ''}`} onClick={() => setPeer(c)}>
              <Avatar name={c.full_name} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}><strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.full_name}</strong>
                  {c.last && <span className="small muted">{hhmm(c.last.created_at)}</span>}</div>
                <div className="row" style={{ gap: 6 }}>
                  <span className="small muted" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.last ? (c.last.from_id === me ? '✓ ' : '') + (c.last.body || '📎 ' + c.last.file_name) : c.detail}
                  </span>
                  {c.unread > 0 && <span className="dot">{c.unread}</span>}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="chat-pane">
        {!peer ? <div style={{ margin: 'auto' }}><Empty icon="💬">Seleccione una conversación</Empty></div> : (
          <>
            <div className="chat-head">
              <button className="icon-btn" onClick={() => setPeer(null)} aria-label="Volver">←</button>
              <Avatar name={peer.full_name} size={40} />
              <div style={{ minWidth: 0 }}>
                <strong>{peer.full_name}</strong>
                <div className="small muted"><span className="badge info" style={{ marginRight: 6 }}>{ROLE[peer.role]}</span>{peer.detail}</div>
              </div>
            </div>
            <div className="msgs">
              {thread.length === 0 && <div className="day-sep">Inicie la conversación con {peer.full_name}</div>}
              <AnimatePresence initial={false}>
                {thread.map((m) => {
                  const day = new Date(m.created_at).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
                  const sep = day !== lastDay ? (lastDay = day) : null;
                  const mine = m.from_id === me;
                  return (
                    <div key={m.id} style={{ display: 'contents' }}>
                      {sep && <div className="day-sep">{sep}</div>}
                      <motion.div className={`msg ${mine ? 'me' : 'them'}`} initial={{ opacity: 0, scale: 0.85, y: 10, originX: mine ? 1 : 0 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 32 }}>
                        {m.file_path && <a href="#" onClick={(e) => { e.preventDefault(); openFile('colegio-chat', m.file_path, m.file_name).catch(toast); }} style={{ color: '#fff', display: 'block', marginBottom: 4 }}>📎 {m.file_name}</a>}
                        {m.body}
                        <div className="t">{hhmm(m.created_at)} {mine && (m.read_at ? <span style={{ color: '#7df9ff' }}>✓✓</span> : '✓')}</div>
                      </motion.div>
                    </div>
                  );
                })}
              </AnimatePresence>
              <div ref={endRef} />
            </div>
            <form className="chat-input" onSubmit={send}>
              <input type="file" ref={fileRef} hidden onChange={(e) => { const f = e.target.files[0]; if (f) send(null, f); e.target.value = ''; }} />
              <button type="button" className="icon-btn" onClick={() => fileRef.current.click()} aria-label="Adjuntar">📎</button>
              <input placeholder="Escriba un mensaje" value={text} onChange={(e) => setText(e.target.value)} />
              <GlowButton variant="solid" type="submit" disabled={sending || !text.trim()}>➤</GlowButton>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
