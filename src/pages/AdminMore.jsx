import { useState } from 'react';
import { motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth, useData } from '../context.jsx';
import { supabase, q, rpc, upload, openFile, signedUrl } from '../lib/supabase.js';
import { DAYS } from '../lib/grading.js';
import { fmtTime, fmtDate, fmtDateTime, todayISO } from '../lib/dates.js';
import {
  Card, Tabs, GlowButton, Empty, Field, Modal, Stagger, StaggerItem, useToast, Avatar, useAsync, Async, EnrollTimeline,
} from '../components/ui.jsx';
import { ScheduleGrid, EventsList, DocumentsList } from '../components/Common.jsx';
import SignaturePad from '../components/SignaturePad.jsx';
import { EventForm } from './Teacher.jsx';
import { StudentForm, ResetPassword, UserForm } from './Admin.jsx';

const confirmDel = (what) => window.confirm(`¿Eliminar ${what}? Esta acción no se puede deshacer.`);
const COLORS = ['#7c5cff', '#00e5ff', '#3ddc97', '#ffb547', '#ff4d6d', '#f72585', '#4cc9f0', '#b5179e', '#90be6d', '#f9844a'];

// ---------- Grupos, salones, asignaturas y horarios ----------
export function Academic() {
  const [tab, setTab] = useState('grupos');
  return (
    <>
      <Tabs tabs={[{ key: 'grupos', label: '🏫 Grupos' }, { key: 'salones', label: '🚪 Salones' }, { key: 'asignaturas', label: '📚 Asignaturas' }, { key: 'horarios', label: '⏰ Horarios y rotación' }]} value={tab} onChange={setTab} />
      {tab === 'grupos' && <Groups />}
      {tab === 'salones' && <Rooms />}
      {tab === 'asignaturas' && <Subjects />}
      {tab === 'horarios' && <ScheduleEditor />}
    </>
  );
}

function useCrud(table) {
  const { reload } = useData();
  const toast = useToast();
  return {
    save: async (row) => {
      try {
        if (row.id) await q(supabase.from(table).update(row).eq('id', row.id)); else await q(supabase.from(table).insert(row));
        await reload(); toast('Guardado'); return true;
      } catch (e) { toast(e); return false; }
    },
    del: async (id) => { try { await q(supabase.from(table).delete().eq('id', id)); await reload(); } catch (e) { toast(e); } },
  };
}

function Groups() {
  const { groups, teachers, staffById } = useData();
  const crud = useCrud('groups');
  const [f, setF] = useState(null);
  const GRADES = ['Transición', '1°', '2°', '3°', '4°', '5°', '6°', '7°', '8°', '9°', '10°', '11°'];
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}><span className="spacer" /><GlowButton variant="solid" onClick={() => setF({ name: '', grade: 6, director_id: '' })}>＋ Nuevo grupo</GlowButton></div>
      {!groups.length ? <Empty icon="🏫">Cree los grupos (ej. 6°A, 6°B…)</Empty> : (
        <Stagger className="grid g4">{groups.map((g) => (
          <StaggerItem key={g.id}><motion.div className="card" whileHover={{ y: -4 }}>
            <h2 className="grad-text">{g.name}</h2><p className="small muted">Grado {GRADES[g.grade]} · {g.year}</p>
            <p className="small">Director(a): {staffById[g.director_id]?.full_name || '—'}</p>
            <div className="row" style={{ marginTop: 10 }}><GlowButton size="sm" variant="ghost" onClick={() => setF(g)}>Editar</GlowButton><GlowButton size="sm" variant="bad" onClick={() => confirmDel(`el grupo ${g.name}`) && crud.del(g.id)}>✕</GlowButton></div>
          </motion.div></StaggerItem>
        ))}</Stagger>
      )}
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? 'Editar grupo' : 'Nuevo grupo'}>
        {f && <form className="form" onSubmit={async (e) => { e.preventDefault(); if (await crud.save({ ...f, grade: Number(f.grade), director_id: f.director_id || null })) setF(null); }}>
          <Field label="Nombre"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="6°A" /></Field>
          <Field label="Grado (año que cursa)"><select value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })}>{GRADES.map((g, i) => <option key={i} value={i}>{g}</option>)}</select></Field>
          <Field label="Director(a) de grupo" className="full"><select value={f.director_id || ''} onChange={(e) => setF({ ...f, director_id: e.target.value })}><option value="">Sin asignar</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></Field>
          <div className="full row" style={{ justifyContent: 'flex-end' }}><GlowButton variant="solid" type="submit">Guardar</GlowButton></div>
        </form>}
      </Modal>
    </>
  );
}

function Rooms() {
  const { rooms } = useData();
  const crud = useCrud('rooms');
  const [name, setName] = useState('');
  return (
    <Card title="Salones físicos">
      <form className="row" style={{ marginBottom: 14 }} onSubmit={async (e) => { e.preventDefault(); if (await crud.save({ name })) setName(''); }}>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Laboratorio de química, Salón 204" style={{ maxWidth: 320 }} />
        <GlowButton variant="solid" type="submit">＋ Agregar</GlowButton>
      </form>
      {!rooms.length ? <Empty icon="🚪">Sin salones</Empty> : (
        <Stagger className="grid g4">{rooms.map((r) => (
          <StaggerItem key={r.id} className="list-item" style={{ alignItems: 'center' }}><span>🚪</span><strong style={{ flex: 1 }}>{r.name}</strong><button className="icon-btn" onClick={() => confirmDel(r.name) && crud.del(r.id)}>✕</button></StaggerItem>
        ))}</Stagger>
      )}
    </Card>
  );
}

function Subjects() {
  const { subjects, groups, teachers, staffById, groupById } = useData();
  const crud = useCrud('subjects');
  const [f, setF] = useState(null);
  const [g, setG] = useState('all');
  const list = subjects.filter((s) => g === 'all' || s.group_id === g);
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <select value={g} onChange={(e) => setG(e.target.value)} style={{ width: 'auto' }}><option value="all">Todos los grupos</option>{groups.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <span className="spacer" />
        <GlowButton variant="solid" disabled={!groups.length} onClick={() => setF({ name: '', group_id: g !== 'all' ? g : groups[0]?.id, teacher_id: '', color: COLORS[subjects.length % COLORS.length] })}>＋ Nueva asignatura</GlowButton>
      </div>
      {!list.length ? <Empty icon="📚">{groups.length ? 'Sin asignaturas' : 'Primero cree los grupos'}</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Asignatura</th><th>Grupo</th><th>Docente</th><th>Escala</th><th></th></tr></thead>
          <tbody>{list.map((s) => (
            <tr key={s.id}><td><span style={{ color: s.color }}>●</span> {s.name}</td><td>{groupById[s.group_id]?.name}</td><td>{staffById[s.teacher_id]?.full_name || '—'}</td><td>{s.scale || 'Institucional'}</td>
              <td><div className="row" style={{ flexWrap: 'nowrap' }}><GlowButton size="sm" variant="ghost" onClick={() => setF(s)}>Editar</GlowButton><GlowButton size="sm" variant="bad" onClick={() => confirmDel(s.name) && crud.del(s.id)}>✕</GlowButton></div></td></tr>
          ))}</tbody>
        </table></div>
      )}
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? 'Editar asignatura' : 'Nueva asignatura'}>
        {f && <form className="form" onSubmit={async (e) => { e.preventDefault(); if (await crud.save({ ...f, teacher_id: f.teacher_id || null })) setF(null); }}>
          <Field label="Nombre"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Matemáticas" /></Field>
          <Field label="Grupo"><select required value={f.group_id} onChange={(e) => setF({ ...f, group_id: e.target.value })}>{groups.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          <Field label="Docente"><select value={f.teacher_id || ''} onChange={(e) => setF({ ...f, teacher_id: e.target.value })}><option value="">Sin asignar</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></Field>
          <Field label="Color"><div className="row">{COLORS.map((c) => <motion.button type="button" key={c} whileHover={{ scale: 1.2 }} onClick={() => setF({ ...f, color: c })} style={{ width: 26, height: 26, borderRadius: 8, border: f.color === c ? '2px solid #fff' : '0', background: c, boxShadow: `0 0 10px ${c}`, cursor: 'pointer' }} />)}</div></Field>
          <div className="full row" style={{ justifyContent: 'flex-end' }}><GlowButton variant="solid" type="submit">Guardar</GlowButton></div>
        </form>}
      </Modal>
    </>
  );
}

// El colegio define en qué salón físico está cada grupo en cada bloque (rotación de salones)
function ScheduleEditor() {
  const { groups, subjects, rooms, schedule, subjectById, roomById } = useData();
  const crud = useCrud('schedule');
  const toast = useToast();
  const [g, setG] = useState(groups[0]?.id || '');
  const blank = { day: 1, start_time: '07:00', end_time: '08:00', subject_id: '', room_id: '' };
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState(null);
  const blocks = schedule.filter((b) => b.group_id === g);
  const subs = subjects.filter((s) => s.group_id === g);
  const validate = (x, selfId) => {
    if (x.end_time <= x.start_time) return 'La hora final debe ser mayor a la inicial';
    const overlap = (b) => b.id !== selfId && b.day === Number(x.day) && fmtTime(b.start_time) < x.end_time && fmtTime(b.end_time) > x.start_time;
    if (x.room_id && schedule.find((b) => overlap(b) && b.room_id === x.room_id && b.group_id !== g)) return `El salón ${roomById[x.room_id]?.name} ya está ocupado por otro grupo en ese horario`;
    if (schedule.find((b) => overlap(b) && b.group_id === g)) return 'El grupo ya tiene otra clase en ese horario';
    const teacher = subjectById[x.subject_id]?.teacher_id;
    if (teacher && schedule.find((b) => overlap(b) && subjectById[b.subject_id]?.teacher_id === teacher)) return 'El docente ya tiene clase con otro grupo en ese horario';
    return null;
  };
  const add = async (e) => {
    e.preventDefault();
    const err = validate(f); if (err) return toast(new Error(err));
    if (await crud.save({ group_id: g, day: Number(f.day), start_time: f.start_time, end_time: f.end_time, subject_id: f.subject_id, room_id: f.room_id || null })) setF({ ...blank, day: f.day, start_time: f.end_time });
  };
  const saveEdit = async (e) => {
    e.preventDefault();
    const x = { ...editing, start_time: fmtTime(editing.start_time), end_time: fmtTime(editing.end_time) };
    const err = validate(x, x.id); if (err) return toast(new Error(err));
    if (await crud.save({ id: x.id, group_id: x.group_id, day: Number(x.day), start_time: x.start_time, end_time: x.end_time, subject_id: x.subject_id, room_id: x.room_id || null })) setEditing(null);
  };
  if (!groups.length) return <Empty icon="⏰">Primero cree grupos, salones y asignaturas</Empty>;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row"><span className="muted">Grupo:</span><Tabs tabs={groups.map((x) => ({ key: x.id, label: x.name }))} value={g} onChange={setG} /></div>
      <Card glow title="Agregar bloque de clase">
        <form className="form" onSubmit={add}>
          <Field label="Día"><select value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })}>{[1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}</select></Field>
          <Field label="Inicio"><input type="time" value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} required /></Field>
          <Field label="Fin"><input type="time" value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} required /></Field>
          <Field label="Asignatura"><select required value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}><option value="">Seleccione…</option>{subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Salón físico"><select value={f.room_id} onChange={(e) => setF({ ...f, room_id: e.target.value })}><option value="">Sin salón</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          <div className="row" style={{ alignItems: 'flex-end' }}><GlowButton variant="solid" type="submit">＋ Agregar bloque</GlowButton></div>
        </form>
      </Card>
      <Card title="Horario del grupo"><ScheduleGrid blocks={blocks} /></Card>
      {blocks.length > 0 && (
        <Card title="Bloques">
          <div className="table-wrap"><table><thead><tr><th>Día</th><th>Hora</th><th>Asignatura</th><th>Salón</th><th></th></tr></thead>
            <tbody>{blocks.map((b) => (
              <tr key={b.id}><td>{DAYS[b.day]}</td><td>{fmtTime(b.start_time)}–{fmtTime(b.end_time)}</td><td>{subjectById[b.subject_id]?.name}</td><td>{roomById[b.room_id]?.name || '—'}</td>
                <td><div className="row" style={{ flexWrap: 'nowrap' }}>
                  <GlowButton size="sm" variant="ghost" onClick={() => setEditing({ ...b, room_id: b.room_id || '' })}>✎ Editar</GlowButton>
                  <button className="icon-btn" onClick={() => confirmDel('este bloque') && crud.del(b.id)}>✕</button>
                </div></td></tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Editar bloque de clase">
        {editing && (
          <form className="form" onSubmit={saveEdit}>
            <Field label="Día"><select value={editing.day} onChange={(e) => setEditing({ ...editing, day: e.target.value })}>{[1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}</select></Field>
            <Field label="Inicio"><input type="time" required value={fmtTime(editing.start_time)} onChange={(e) => setEditing({ ...editing, start_time: e.target.value })} /></Field>
            <Field label="Fin"><input type="time" required value={fmtTime(editing.end_time)} onChange={(e) => setEditing({ ...editing, end_time: e.target.value })} /></Field>
            <Field label="Asignatura"><select required value={editing.subject_id} onChange={(e) => setEditing({ ...editing, subject_id: e.target.value })}>{subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Salón físico"><select value={editing.room_id} onChange={(e) => setEditing({ ...editing, room_id: e.target.value })}><option value="">Sin salón</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <div className="full row" style={{ justifyContent: 'flex-end' }}><GlowButton variant="solid" type="submit">Guardar cambios</GlowButton></div>
          </form>
        )}
      </Modal>
    </div>
  );
}

// ---------- Documentos institucionales ----------
export function AdminDocuments() {
  const toast = useToast();
  const [k, setK] = useState(0);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    const fd = new FormData(e.target); const file = fd.get('file');
    try {
      const up = await upload('colegio-documentos', file);
      await q(supabase.from('documents').insert({ title: fd.get('title'), category: fd.get('category'), path: up.path, file_name: up.name }));
      e.target.reset(); setK(k + 1); toast('Documento publicado para toda la comunidad');
    } catch (err) { toast(err); } finally { setBusy(false); }
  };
  const del = async (d) => {
    if (!confirmDel(d.title)) return;
    await supabase.storage.from('colegio-documentos').remove([d.path]);
    await supabase.from('documents').delete().eq('id', d.id); setK(k + 1);
  };
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card glow title="Subir documento institucional">
        <form className="form" onSubmit={submit}>
          <Field label="Título"><input name="title" required placeholder="Manual de convivencia 2026" /></Field>
          <Field label="Categoría"><select name="category">{['Manual de convivencia', 'PEI', 'SIEE (evaluación)', 'Circular', 'Calendario académico', 'Lista de útiles', 'Otro'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Archivo"><input name="file" type="file" required /></Field>
          <div className="row" style={{ alignItems: 'flex-end' }}><GlowButton variant="solid" type="submit" disabled={busy}>{busy ? 'Subiendo…' : '⬆ Publicar'}</GlowButton></div>
        </form>
      </Card>
      <DocumentsList admin onDelete={del} reloadKey={k} />
    </div>
  );
}

// ---------- Matrículas ----------
const STATUS_LABEL = { inscripcion: 'Inscripción', revision: 'En revisión', entrevista: 'Entrevista', aceptado: 'Aceptado', rechazado: 'Rechazado' };
const STATUS_CLS = { inscripcion: 'info', revision: 'warn', entrevista: 'warn', aceptado: 'ok', rechazado: 'bad' };

export function Enrollments() {
  const { settings, reload } = useData();
  const toast = useToast();
  const st = useAsync(() => q(supabase.from('enrollments').select('*').order('created_at', { ascending: false })), []);
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState('todas');
  const [cfg, setCfg] = useState(settings.enrollment || { open: true, required_docs: [] });
  const [docInput, setDocInput] = useState('');
  const [create, setCreate] = useState(null);
  const link = `${location.origin}${import.meta.env.BASE_URL}#/matricula`;

  const saveCfg = async (next) => {
    setCfg(next);
    try { await q(supabase.from('cg_settings').upsert({ key: 'enrollment', value: next })); reload(); } catch (e) { toast(e); }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g2">
        <Card glow title="🔗 Enlace externo de matrículas">
          <div className="row">
            <div style={{ background: '#fff', padding: 8, borderRadius: 10 }}><QRCodeSVG value={link} size={96} /></div>
            <div className="col" style={{ flex: 1 }}>
              <code className="small" style={{ wordBreak: 'break-all' }}>{link}</code>
              <div className="row">
                <GlowButton size="sm" onClick={() => { navigator.clipboard.writeText(link); toast('Enlace copiado'); }}>Copiar</GlowButton>
                <GlowButton size="sm" variant="ghost" onClick={() => window.open(link, '_blank')}>Abrir</GlowButton>
              </div>
              <label className="row small"><input type="checkbox" checked={!!cfg.open} onChange={(e) => saveCfg({ ...cfg, open: e.target.checked })} /> Inscripciones abiertas</label>
            </div>
          </div>
        </Card>
        <Card title="Documentos que se exigen">
          <div className="col" style={{ gap: 6 }}>
            {(cfg.required_docs || []).map((d, i) => (
              <div key={i} className="row small"><span style={{ flex: 1 }}>📎 {d}</span><button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => saveCfg({ ...cfg, required_docs: cfg.required_docs.filter((_, j) => j !== i) })}>✕</button></div>
            ))}
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (docInput.trim()) { saveCfg({ ...cfg, required_docs: [...(cfg.required_docs || []), docInput.trim()] }); setDocInput(''); } }}>
              <input value={docInput} onChange={(e) => setDocInput(e.target.value)} placeholder="Ej. Diploma de bachiller, certificado…" style={{ flex: 1, width: 'auto' }} /><GlowButton size="sm" type="submit">＋</GlowButton>
            </form>
          </div>
        </Card>
      </div>
      <Card title="Solicitudes">
        <Tabs tabs={['todas', 'inscripcion', 'revision', 'entrevista', 'aceptado', 'rechazado'].map((k) => ({ key: k, label: k === 'todas' ? 'Todas' : STATUS_LABEL[k] }))} value={filter} onChange={setFilter} />
        <Async state={st}>{(rows) => {
          const list = rows.filter((r) => filter === 'todas' || r.status === filter);
          return !list.length ? <Empty icon="📝">Sin solicitudes</Empty> : (
            <Stagger>{list.map((r) => (
              <StaggerItem key={r.id} className="list-item" style={{ alignItems: 'center', cursor: 'pointer' }} onClick={() => setSel(r)}>
                <Avatar name={r.data.student_name} size={38} />
                <div style={{ flex: 1 }}><strong>{r.data.student_name}</strong><div className="small muted">{r.code} · Grado {r.data.grade} · {fmtDateTime(r.created_at)}</div></div>
                <span className={`badge ${STATUS_CLS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              </StaggerItem>
            ))}</Stagger>
          );
        }}</Async>
      </Card>
      <EnrollmentDetail item={sel} onClose={() => setSel(null)} onChanged={() => { st.reload(); setSel(null); }} onCreate={(r) => { setSel(null); setCreate(r); }} />
      <StudentForm student={create ? {} : null} prefill={create ? { ...create.data, guardian2: create.data.guardian2 } : undefined} parents={[]} onClose={() => setCreate(null)} onSaved={() => setCreate(null)} />
    </div>
  );
}

function EnrollmentDetail({ item, onClose, onChanged, onCreate }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [sig, setSig] = useState(null);
  if (!item) return <Modal open={false} />;
  const d = item.data;
  const setStatus = async (status) => {
    if (status === 'aceptado' && !item.sig_school && !sig) return toast(new Error('Falta la firma del responsable del colegio'));
    try { await rpc('cg_admin_enrollment_status', { p_id: item.id, p_status: status, p_note: note || null, p_sig_school: sig }); toast(`Estado: ${STATUS_LABEL[status]}`); onChanged(); } catch (e) { toast(e); }
  };
  const Row = ({ k, v }) => v ? <div className="small"><span className="muted">{k}:</span> {v}</div> : null;
  return (
    <Modal open={!!item} onClose={onClose} title={`Matrícula ${item.code}`} wide>
      <EnrollTimeline status={item.status} history={item.history} />
      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card col" style={{ gap: 4 }}><strong>🎒 Estudiante</strong>
          <Row k="Nombre" v={d.student_name} /><Row k="Documento" v={d.student_doc} /><Row k="Nacimiento" v={d.birth_date} /><Row k="Grado al que aspira" v={d.grade} />
          <Row k="Colegio anterior" v={d.previous_school} /><Row k="Dirección" v={d.address} /><Row k="EPS" v={d.eps} /><Row k="Clínica" v={d.clinic} />
        </div>
        <div className="card col" style={{ gap: 4 }}><strong>👤 Acudiente</strong>
          <Row k="Nombre" v={d.parent_name} /><Row k="Documento" v={d.parent_doc} /><Row k="Teléfono" v={d.parent_phone} /><Row k="Correo" v={d.parent_email} /><Row k="Parentesco" v={d.parent_relation} />
          {d.guardian2?.name && <><strong style={{ marginTop: 8 }}>👥 Segundo responsable</strong><Row k="Nombre" v={d.guardian2.name} /><Row k="Teléfono" v={d.guardian2.phone} /></>}
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}><strong>📎 Documentos adjuntos</strong>
        <div className="col" style={{ gap: 4, marginTop: 8 }}>
          {(item.files || []).length === 0 && <span className="small muted">Sin archivos</span>}
          {(item.files || []).map((f) => <a key={f.path} href="#" className="small" onClick={(e) => { e.preventDefault(); openFile('colegio-matriculas', f.path, f.name).catch(toast); }}>📄 {f.label}: {f.name}</a>)}
        </div>
      </div>
      <div className="grid g3" style={{ marginTop: 14 }}>
        {[['Padre / representante', item.sig_parent], ['Estudiante', item.sig_student], ['Responsable del colegio', item.sig_school]].map(([l, s]) => (
          <div key={l} className="card"><span className="small muted">Firma · {l}</span>{s ? <img src={s} alt={`Firma ${l}`} style={{ width: '100%', background: '#fff', borderRadius: 10, marginTop: 6 }} /> : <p className="small" style={{ color: 'var(--warn)' }}>Pendiente</p>}</div>
        ))}
      </div>
      {!['aceptado', 'rechazado'].includes(item.status) && (
        <div className="col" style={{ marginTop: 14 }}>
          {!item.sig_school && <SignaturePad label="Firma del responsable del colegio" onChange={setSig} />}
          <Field label="Nota para el historial (visible para la familia)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. Entrevista el lunes 8:00 a. m." /></Field>
          <div className="row">
            <GlowButton variant="warn" onClick={() => setStatus('revision')}>🔎 En revisión</GlowButton>
            <GlowButton onClick={() => setStatus('entrevista')}>🗣️ Citar a entrevista</GlowButton>
            <GlowButton variant="ok" onClick={() => setStatus('aceptado')}>✓ Aceptar</GlowButton>
            <GlowButton variant="bad" onClick={() => setStatus('rechazado')}>✕ Rechazar</GlowButton>
          </div>
        </div>
      )}
      {item.status === 'aceptado' && <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}><GlowButton variant="solid" onClick={() => onCreate(item)}>🎒 Crear cuentas del estudiante y acudiente</GlowButton></div>}
    </Modal>
  );
}

// ---------- Vigilancia y salidas ----------
export function Security() {
  const { profile } = useAuth();
  const toast = useToast();
  const guards = useAsync(() => q(supabase.from('profiles').select('*').eq('role', 'guard')), []);
  const exits = useAsync(() => q(supabase.from('exit_permissions').select('*, student:students(doc_id, profile:profiles!students_id_fkey(full_name)), requester:profiles!exit_permissions_requested_by_fkey(full_name)').gte('valid_date', todayISO()).order('created_at', { ascending: false })), []);
  const students = useAsync(() => q(supabase.from('students').select('id, doc_id, profile:profiles!students_id_fkey(full_name)')), []);
  const [guardEdit, setGuardEdit] = useState(null);
  const [pw, setPw] = useState(null);
  const [auth, setAuth] = useState(false);
  const link = `${location.origin}${import.meta.env.BASE_URL}#/vigilante`;
  const authorize = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try { await q(supabase.from('exit_permissions').insert({ student_id: f.student, requested_by: profile.id, requester_role: 'colegio', reason: f.reason, pickup_person: f.pickup, valid_date: f.date })); setAuth(false); exits.reload(); toast('Salida autorizada'); } catch (err) { toast(err); }
  };
  const revoke = async (id) => { await supabase.from('exit_permissions').update({ status: 'revocada' }).eq('id', id); exits.reload(); };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g2">
        <Card glow title="🔗 Enlace de portería">
          <div className="row">
            <div style={{ background: '#fff', padding: 8, borderRadius: 10 }}><QRCodeSVG value={link} size={96} /></div>
            <div className="col" style={{ flex: 1 }}>
              <code className="small" style={{ wordBreak: 'break-all' }}>{link}</code>
              <p className="small muted">El vigilante ingresa con su usuario, escanea el QR del carné o digita el documento y ve si el estudiante está autorizado.</p>
              <GlowButton size="sm" onClick={() => { navigator.clipboard.writeText(link); toast('Enlace copiado'); }}>Copiar enlace</GlowButton>
            </div>
          </div>
        </Card>
        <Card title="Personal de vigilancia" actions={<GlowButton size="sm" variant="solid" onClick={() => setGuardEdit({ role: 'guard' })}>＋ Crear</GlowButton>}>
          <Async state={guards}>{(list) => !list.length ? <Empty icon="🛡️">Sin vigilantes</Empty> : list.map((g) => (
            <div key={g.id} className="list-item" style={{ alignItems: 'center', marginBottom: 6 }}><Avatar name={g.full_name} size={32} /><div style={{ flex: 1 }}><strong>{g.full_name}</strong><div className="small muted">@{g.username} · {g.phone || 'sin teléfono'}</div></div>
              <GlowButton size="sm" onClick={() => setGuardEdit({ ...g })}>✎</GlowButton>
              <GlowButton size="sm" variant="warn" onClick={() => setPw(g)}>🔑</GlowButton>
              <GlowButton size="sm" variant="bad" onClick={async () => { if (confirmDel(g.full_name)) { await rpc('cg_admin_delete_user', { uid: g.id }).catch(toast); guards.reload(); } }}>✕</GlowButton></div>
          ))}</Async>
        </Card>
      </div>
      <Card title="Autorizaciones de salida vigentes" actions={<GlowButton variant="solid" onClick={() => setAuth(true)}>＋ Autorizar salida</GlowButton>}>
        <Async state={exits}>{(rows) => !rows.length ? <Empty icon="🚪">Sin autorizaciones para hoy o próximos días</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Estudiante</th><th>Fecha</th><th>Motivo</th><th>Recoge</th><th>Autoriza</th><th>Ubicación</th><th>Estado</th><th></th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id}><td>{e.student?.profile?.full_name}</td><td>{fmtDate(e.valid_date)}</td><td>{e.reason}</td><td>{e.pickup_person}</td><td>{e.requester?.full_name} <span className="small muted">({e.requester_role})</span></td>
                <td>{e.lat ? <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${e.lat},${e.lng}`}>📍 Ver</a> : '—'}</td>
                <td><span className={`badge ${e.status === 'usada' ? 'ok' : e.status === 'revocada' ? 'bad' : 'info'}`}>{e.status}</span></td>
                <td>{e.status === 'autorizada' && <GlowButton size="sm" variant="bad" onClick={() => revoke(e.id)}>Revocar</GlowButton>}</td></tr>
            ))}</tbody>
          </table></div>
        )}</Async>
      </Card>
      <UserForm user={guardEdit} onClose={() => setGuardEdit(null)} onSaved={() => { setGuardEdit(null); guards.reload(); }} />
      <Modal open={auth} onClose={() => setAuth(false)} title="Autorizar salida (colegio)">
        <form className="col" onSubmit={authorize}>
          <Field label="Estudiante"><select name="student" required><option value="">Seleccione…</option>{(students.data || []).sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name)).map((s) => <option key={s.id} value={s.id}>{s.profile.full_name} · {s.doc_id}</option>)}</select></Field>
          <Field label="Fecha"><input name="date" type="date" defaultValue={todayISO()} min={todayISO()} required /></Field>
          <Field label="Motivo"><input name="reason" required /></Field>
          <Field label="Persona que recoge"><input name="pickup" required /></Field>
          <GlowButton variant="solid" type="submit">Autorizar</GlowButton>
        </form>
      </Modal>
      <ResetPassword user={pw} onClose={() => setPw(null)} />
    </div>
  );
}

// ---------- Agenda institucional ----------
export function AdminEvents() {
  const { groups } = useData();
  const [ev, setEv] = useState(null);
  const [k, setK] = useState(0);
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}><span className="spacer" /><GlowButton variant="solid" onClick={() => setEv({ kind: 'salida', group_id: '', starts_at: new Date().toISOString() })}>＋ Agendar actividad</GlowButton></div>
      <EventsList editable onEdit={setEv} reloadKey={k} />
      <EventForm event={ev} groups={groups} allowAllSchool onClose={() => setEv(null)} onSaved={() => { setEv(null); setK(k + 1); }} />
    </>
  );
}

// ---------- Ajustes ----------
export function Settings() {
  const { school, reload } = useData();
  const toast = useToast();
  const [f, setF] = useState(school);
  const save = async (e) => {
    e.preventDefault();
    try { await q(supabase.from('cg_settings').upsert({ key: 'school', value: f })); await reload(); toast('Ajustes guardados'); } catch (err) { toast(err); }
  };
  return (
    <div className="grid g2">
      <Card glow title="Datos de la institución">
        <form className="col" onSubmit={save}>
          <Field label="Nombre del colegio"><input value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Ciudad"><input value={f.city || ''} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="Año lectivo"><input type="number" value={f.year || ''} onChange={(e) => setF({ ...f, year: Number(e.target.value) })} /></Field>
          <Field label="Código DANE"><input value={f.dane || ''} onChange={(e) => setF({ ...f, dane: e.target.value })} /></Field>
          <GlowButton variant="solid" type="submit">Guardar</GlowButton>
        </form>
      </Card>
      <Card title="🔐 Seguridad">
        <div className="col small" style={{ gap: 8 }}>
          <p>• Las contraseñas se guardan cifradas (bcrypt) en la base de datos y se validan solo en el servidor de Supabase.</p>
          <p>• Cada consulta está protegida por políticas RLS según el rol: un acudiente solo ve a sus hijos, un docente solo a sus grupos.</p>
          <p>• Sesión única: al iniciar sesión en otro dispositivo, la sesión anterior se cierra.</p>
          <p style={{ color: 'var(--warn)' }}>⚠️ Cambie la contraseña inicial del administrador (1234) con el botón “🔑 Clave” del menú.</p>
        </div>
      </Card>
    </div>
  );
}
