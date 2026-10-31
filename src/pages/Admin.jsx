import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import Shell from '../components/Shell.jsx';
import Chat from '../components/Chat.jsx';
import { useData, scaleOf } from '../context.jsx';
import { supabase, q, rpc } from '../lib/supabase.js';
import { SCALES, weightedAverage, normalize, fmtNorm } from '../lib/grading.js';
import { monthLabel } from '../lib/dates.js';
import {
  Card, Tabs, GlowButton, Empty, Field, Modal, Stagger, StaggerItem, Progress, Kpi, Bars, useToast, Avatar, useAsync, Async,
} from '../components/ui.jsx';
import { EPS } from '../lib/eps.js';
import { Academic, AdminDocuments, Enrollments, Security, AdminEvents, Settings } from './AdminMore.jsx';
import { AdminAnnouncements } from '../components/Announcements.jsx';

const NAV = [
  { key: 'analitica', label: 'Analítica', icon: '📈' },
  { key: 'calificacion', label: 'Calificación', icon: '🎯' },
  { key: 'docentes', label: 'Docentes', icon: '🧑‍🏫' },
  { key: 'estudiantes', label: 'Estudiantes', icon: '🎒' },
  { key: 'padres', label: 'Padres', icon: '👨‍👩‍👧' },
  { key: 'comunicados', label: 'Comunicados', icon: '📢' },
  { key: 'academico', label: 'Grupos y horarios', icon: '🏫' },
  { key: 'documentos', label: 'Documentos', icon: '📘' },
  { key: 'matriculas', label: 'Matrículas', icon: '📝' },
  { key: 'agenda', label: 'Actividades', icon: '🚌' },
  { key: 'vigilancia', label: 'Vigilancia', icon: '🛡️' },
  { key: 'chat', label: 'Chat', icon: '💬' },
  { key: 'ajustes', label: 'Ajustes', icon: '⚙️' },
];

export default function Admin() {
  const [tab, setTab] = useState('analitica');
  const { school } = useData();
  return (
    <Shell nav={NAV} active={tab} onNav={setTab} title={NAV.find((n) => n.key === tab)?.label} subtitle={`${school.name} · Panel del colegio`}>
      {tab === 'analitica' && <Analytics />}
      {tab === 'calificacion' && <GradingSettings />}
      {tab === 'docentes' && <Teachers />}
      {tab === 'estudiantes' && <Students />}
      {tab === 'padres' && <Parents />}
      {tab === 'comunicados' && <AdminAnnouncements />}
      {tab === 'academico' && <Academic />}
      {tab === 'documentos' && <AdminDocuments />}
      {tab === 'matriculas' && <Enrollments />}
      {tab === 'agenda' && <AdminEvents />}
      {tab === 'vigilancia' && <Security />}
      {tab === 'chat' && <Chat />}
      {tab === 'ajustes' && <Settings />}
    </Shell>
  );
}

// ---------- Analítica ----------
function Analytics() {
  const { groups, subjects, teachers, subjectById, grading, staffById } = useData();
  const st = useAsync(async () => {
    const [students, tasks, grades, attendance, topics] = await Promise.all([
      q(supabase.from('students').select('id, group_id, profile:profiles!students_id_fkey(full_name)')),
      q(supabase.from('tasks').select('id, subject_id, weight, period')),
      q(supabase.from('grades').select('task_id, student_id, value')),
      q(supabase.from('attendance').select('student_id, subject_id, date, status')),
      q(supabase.from('topics').select('subject_id, done')),
    ]);
    return { students, tasks, grades, attendance, topics };
  }, []);
  const [rankGroup, setRankGroup] = useState('all');

  return (
    <Async state={st}>{(d) => {
      const taskById = Object.fromEntries(d.tasks.map((t) => [t.id, t]));
      // promedio normalizado (0..1) por estudiante y asignatura
      const perStudent = {};
      for (const s of d.students) {
        const subs = subjects.filter((x) => x.group_id === s.group_id);
        const vals = subs.map((sb) => {
          const items = d.grades.filter((g) => g.student_id === s.id && taskById[g.task_id]?.subject_id === sb.id).map((g) => ({ value: g.value, weight: taskById[g.task_id].weight }));
          const avg = weightedAverage(items);
          return avg == null ? null : normalize(avg, scaleOf(sb, grading));
        }).filter((v) => v != null);
        perStudent[s.id] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      }
      const attPct = (rows) => rows.length ? (100 * rows.filter((a) => a.status !== 'ausente').length) / rows.length : null;
      const studentGroup = Object.fromEntries(d.students.map((s) => [s.id, s.group_id]));

      const byGroup = groups.map((g) => {
        const ids = d.students.filter((s) => s.group_id === g.id).map((s) => s.id);
        const avgs = ids.map((i) => perStudent[i]).filter((v) => v != null);
        return { g, avg: avgs.length ? (100 * avgs.reduce((a, b) => a + b, 0)) / avgs.length : null, att: attPct(d.attendance.filter((a) => studentGroup[a.student_id] === g.id)), n: ids.length };
      });
      const months = [...new Set(d.attendance.map((a) => a.date.slice(0, 7)))].sort().slice(-8);
      const byMonth = months.map((m) => ({ m, att: attPct(d.attendance.filter((a) => a.date.startsWith(m))), abs: d.attendance.filter((a) => a.date.startsWith(m) && a.status === 'ausente').length }));
      const teacherProgress = teachers.map((t) => {
        const subIds = subjects.filter((s) => s.teacher_id === t.id).map((s) => s.id);
        const tp = d.topics.filter((x) => subIds.includes(x.subject_id));
        return { t, pct: tp.length ? (100 * tp.filter((x) => x.done).length) / tp.length : 0, total: tp.length };
      }).sort((a, b) => b.pct - a.pct || b.total - a.total);
      const ranking = d.students.filter((s) => perStudent[s.id] != null && (rankGroup === 'all' || s.group_id === rankGroup))
        .map((s) => ({ s, v: perStudent[s.id] })).sort((a, b) => b.v - a.v);
      const bestPerGroup = groups.map((g) => ({ g, best: d.students.filter((s) => s.group_id === g.id && perStudent[s.id] != null).sort((a, b) => perStudent[b.id] - perStudent[a.id])[0] }));

      return (
        <div className="col" style={{ gap: 16 }}>
          <div className="grid g4">
            <Kpi icon="🎒" label="Estudiantes" value={d.students.length} />
            <Kpi icon="🧑‍🏫" label="Docentes" value={teachers.length} delay={0.05} />
            <Kpi icon="✅" label="Asistencia global" value={attPct(d.attendance)} suffix="%" delay={0.1} />
            <Kpi icon="🚨" label="Inasistencias" value={d.attendance.filter((a) => a.status === 'ausente').length} delay={0.15} />
          </div>
          <div className="grid g2">
            <Card title="Rendimiento por salón (promedio %)"><Bars data={byGroup.map((x) => ({ label: x.g.name, value: x.avg == null ? null : Math.round(x.avg) }))} max={100} format={(v) => v + '%'} /></Card>
            <Card title="Asistencia por salón"><Bars data={byGroup.map((x) => ({ label: x.g.name, value: x.att == null ? null : Math.round(x.att) }))} max={100} format={(v) => v + '%'} color="linear-gradient(180deg,#3ddc97,#00b3c7)" /></Card>
            <Card title="Asistencia por mes"><Bars data={byMonth.map((x) => ({ label: monthLabel(x.m).slice(0, 3), value: x.att == null ? null : Math.round(x.att) }))} max={100} format={(v) => v + '%'} color="linear-gradient(180deg,#00e5ff,#7c5cff)" /></Card>
            <Card title="Inasistencias por mes"><Bars data={byMonth.map((x) => ({ label: monthLabel(x.m).slice(0, 3), value: x.abs }))} color="linear-gradient(180deg,#ff9f43,#ff4d6d)" /></Card>
          </div>
          <div className="grid g2">
            <Card glow title="🏆 Docentes que más avanzan en su cronograma">
              {!teacherProgress.length ? <Empty>Sin docentes</Empty> : (
                <Stagger>{teacherProgress.map((x, i) => (
                  <StaggerItem key={x.t.id} className="list-item" style={{ alignItems: 'center' }}>
                    <span style={{ fontSize: 22, width: 30 }}>{['🥇', '🥈', '🥉'][i] || `#${i + 1}`}</span>
                    <div style={{ flex: 1 }}><strong>{x.t.full_name}</strong><Progress value={x.pct} /></div>
                    <strong>{Math.round(x.pct)}%</strong><span className="small muted">{x.total} temas</span>
                  </StaggerItem>
                ))}</Stagger>
              )}
            </Card>
            <Card glow title="⭐ Mejor estudiante por salón">
              <Stagger>{bestPerGroup.map(({ g, best }) => (
                <StaggerItem key={g.id} className="list-item" style={{ alignItems: 'center' }}>
                  <span className="badge info">{g.name}</span>
                  {best ? <><Avatar name={best.profile.full_name} size={32} /><strong style={{ flex: 1 }}>{best.profile.full_name}</strong><span className="badge ok">{fmtNorm(perStudent[best.id], grading.scale)}</span></> : <span className="muted small">Sin notas</span>}
                </StaggerItem>
              ))}</Stagger>
            </Card>
          </div>
          <Card title="Ranking de estudiantes" actions={
            <select value={rankGroup} onChange={(e) => setRankGroup(e.target.value)} style={{ width: 'auto' }}><option value="all">Todo el colegio</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}>
            {!ranking.length ? <Empty icon="🏆">Aún no hay notas registradas</Empty> : (
              <div className="table-wrap"><table>
                <thead><tr><th>#</th><th>Estudiante</th><th>Grupo</th><th>Promedio ({grading.scale})</th><th>Rendimiento</th></tr></thead>
                <tbody>{ranking.slice(0, 50).map((r, i) => (
                  <motion.tr key={r.s.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}>
                    <td>{['🥇', '🥈', '🥉'][i] || i + 1}</td><td>{r.s.profile.full_name}</td><td>{groups.find((g) => g.id === r.s.group_id)?.name}</td>
                    <td><strong>{fmtNorm(r.v, grading.scale)}</strong></td><td style={{ minWidth: 140 }}><Progress value={r.v * 100} /></td>
                  </motion.tr>
                ))}</tbody>
              </table></div>
            )}
          </Card>
        </div>
      );
    }}</Async>
  );
}

// ---------- Forma de calificación ----------
function GradingSettings() {
  const { grading, reload } = useData();
  const toast = useToast();
  const [f, setF] = useState(grading);
  const save = async () => {
    try { await q(supabase.from('cg_settings').upsert({ key: 'grading', value: f })); await reload(); toast('Escala institucional guardada'); } catch (e) { toast(e); }
  };
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card glow title="Escala de valoración institucional" actions={<GlowButton variant="solid" onClick={save}>Guardar</GlowButton>}>
        <p className="muted small" style={{ marginBottom: 14 }}>
          Según el Decreto 1290 de 2009, cada colegio define su escala y la hace equivalente a la escala nacional: Desempeño Superior, Alto, Básico y Bajo. La más usada en Colombia es de 1.0 a 5.0 con 3.0 como nota mínima aprobatoria.
        </p>
        <div className="grid g3">
          {Object.values(SCALES).map((s) => (
            <motion.div key={s.id} className="card" whileHover={{ y: -4 }} onClick={() => setF({ ...f, scale: s.id })}
              style={{ cursor: 'pointer', borderColor: f.scale === s.id ? 'var(--b)' : undefined, boxShadow: f.scale === s.id ? 'var(--glow)' : undefined }}>
              <div className="row"><strong style={{ flex: 1 }}>{s.label}</strong>{f.scale === s.id && <span className="badge ok">Seleccionada</span>}</div>
              <div className="col" style={{ gap: 4, marginTop: 10 }}>
                {[...s.levels].reverse().map((l) => <div key={l.name} className="row small"><span style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} /><span style={{ flex: 1 }}>{l.name}</span><span>{l.from} – {l.to}</span></div>)}
              </div>
            </motion.div>
          ))}
        </div>
        <label className="row" style={{ marginTop: 16 }}><input type="checkbox" checked={!!f.teacher_can_choose} onChange={(e) => setF({ ...f, teacher_can_choose: e.target.checked })} /> Permitir que cada docente elija la escala (1–5, 1–10 o 0–100) en su asignatura</label>
      </Card>
    </div>
  );
}

// ---------- Docentes ----------
function Teachers() {
  const { teachers, subjects, groups, reload } = useData();
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [pw, setPw] = useState(null);
  const del = async (t) => { if (!window.confirm(`¿Eliminar al docente ${t.full_name}?`)) return; try { await rpc('cg_admin_delete_user', { uid: t.id }); reload(); } catch (e) { toast(e); } };
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}><span className="muted">{teachers.length} docentes</span><span className="spacer" /><GlowButton variant="solid" onClick={() => setEdit({ role: 'teacher' })}>＋ Crear docente</GlowButton></div>
      {!teachers.length ? <Empty icon="🧑‍🏫">Aún no hay docentes</Empty> : (
        <Stagger className="grid g3">{teachers.map((t) => (
          <StaggerItem key={t.id}>
            <motion.div className="card" whileHover={{ y: -4 }} style={{ height: '100%' }}>
              <div className="row"><Avatar name={t.full_name} /><div style={{ flex: 1 }}><strong>{t.full_name}</strong><div className="small muted">@{t.username}</div></div></div>
              <div className="col small" style={{ gap: 2, margin: '10px 0' }}>
                <span>🪪 {t.doc_id || '—'}</span><span>📞 {t.phone || '—'}</span><span>✉️ {t.email || '—'}</span>
              </div>
              <div className="small" style={{ marginBottom: 10 }}>
                {subjects.filter((s) => s.teacher_id === t.id).map((s) => <span key={s.id} className="badge" style={{ margin: 2 }}>{s.name} {groups.find((g) => g.id === s.group_id)?.name}</span>)}
                {groups.filter((g) => g.director_id === t.id).map((g) => <span key={g.id} className="badge info" style={{ margin: 2 }}>Director {g.name}</span>)}
              </div>
              <div className="row">
                <GlowButton size="sm" onClick={() => setEdit({ ...t, role: 'teacher' })}>✎ Editar</GlowButton>
                <GlowButton size="sm" variant="warn" onClick={() => setPw(t)}>🔑</GlowButton>
                <GlowButton size="sm" variant="bad" onClick={() => del(t)}>✕</GlowButton>
              </div>
            </motion.div>
          </StaggerItem>
        ))}</Stagger>
      )}
      <UserForm user={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
      <ResetPassword user={pw} onClose={() => setPw(null)} />
    </>
  );
}

// Crear / editar cualquier usuario (docente, padre, vigilante). Para docentes permite asignar asignaturas y dirección de grupo.
export function UserForm({ user, onClose, onSaved }) {
  const { subjects, groups, groupById } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [subs, setSubs] = useState([]);
  const [dirs, setDirs] = useState([]);
  const isEdit = !!user?.id;
  const isTeacher = user?.role === 'teacher';
  const key = user ? user.id || 'new-' + user.role : null;
  useEffect(() => {
    if (!user) return;
    setSubs(subjects.filter((s) => user.id && s.teacher_id === user.id).map((s) => s.id));
    setDirs(groups.filter((g) => user.id && g.director_id === user.id).map((g) => g.id));
  }, [key]); // eslint-disable-line
  const TITLE = { teacher: 'docente', parent: 'padre de familia', guard: 'vigilante' };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    const f = Object.fromEntries(new FormData(e.target));
    try {
      let uid = user.id;
      if (isEdit) await rpc('cg_admin_update_user', { uid, p_username: f.username, p_full_name: f.name, p_doc: f.doc || null, p_phone: f.phone || null, p_email: f.email || null });
      else uid = await rpc('cg_admin_create_user', { p_username: f.username, p_password: f.password, p_role: user.role, p_full_name: f.name, p_doc: f.doc || null, p_phone: f.phone || null, p_email: f.email || null });
      if (isTeacher) {
        const prevS = subjects.filter((s) => s.teacher_id === uid).map((s) => s.id);
        const addS = subs.filter((x) => !prevS.includes(x)), remS = prevS.filter((x) => !subs.includes(x));
        if (addS.length) await q(supabase.from('subjects').update({ teacher_id: uid }).in('id', addS));
        if (remS.length) await q(supabase.from('subjects').update({ teacher_id: null }).in('id', remS));
        const prevG = groups.filter((g) => g.director_id === uid).map((g) => g.id);
        const addG = dirs.filter((x) => !prevG.includes(x)), remG = prevG.filter((x) => !dirs.includes(x));
        if (addG.length) await q(supabase.from('groups').update({ director_id: uid }).in('id', addG));
        if (remG.length) await q(supabase.from('groups').update({ director_id: null }).in('id', remG));
      }
      toast(isEdit ? 'Cambios guardados' : `Cuenta de ${TITLE[user.role]} creada`); onSaved(uid);
    } catch (err) { toast(err); } finally { setBusy(false); }
  };
  const toggle = (arr, set, id) => set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  return (
    <Modal open={!!user} onClose={onClose} title={`${isEdit ? 'Editar' : 'Crear'} ${TITLE[user?.role] || 'usuario'}`} wide={isTeacher}>
      {user && (
        <form className="col" onSubmit={submit} key={key}>
          <fieldset><legend>👤 Datos personales</legend>
            <Field label="Nombre completo"><input name="name" required defaultValue={user.full_name} /></Field>
            <Field label="Documento"><input name="doc" defaultValue={user.doc_id} /></Field>
            <Field label="Teléfono"><input name="phone" type="tel" defaultValue={user.phone} /></Field>
            <Field label="Correo"><input name="email" type="email" defaultValue={user.email} /></Field>
          </fieldset>
          <fieldset><legend>🔐 Acceso</legend>
            <Field label="Usuario"><input name="username" required pattern="[a-zA-Z0-9._\-]{3,40}" autoComplete="off" defaultValue={user.username} /></Field>
            {!isEdit && <Field label="Contraseña"><input name="password" type="password" required minLength={4} autoComplete="new-password" /></Field>}
            {isEdit && <p className="small muted" style={{ alignSelf: 'end' }}>La contraseña se cambia con el botón 🔑</p>}
          </fieldset>
          {isTeacher && (
            <fieldset><legend>📚 Carga académica</legend>
              <div className="full col" style={{ gap: 6 }}>
                <span className="small muted">Asignaturas que dicta</span>
                <div className="row">{subjects.map((s) => (
                  <motion.button type="button" key={s.id} whileTap={{ scale: 0.92 }} className={`gbtn sm ${subs.includes(s.id) ? 'solid' : 'ghost'}`} onClick={() => toggle(subs, setSubs, s.id)}>
                    {subs.includes(s.id) ? '✓ ' : ''}{s.name} · {groupById[s.group_id]?.name}</motion.button>
                ))}{!subjects.length && <span className="small muted">Primero cree asignaturas en “Grupos y horarios”.</span>}</div>
                <span className="small muted" style={{ marginTop: 8 }}>Director(a) de grupo de</span>
                <div className="row">{groups.map((g) => (
                  <motion.button type="button" key={g.id} whileTap={{ scale: 0.92 }} className={`gbtn sm ${dirs.includes(g.id) ? 'solid ok' : 'ghost'}`} onClick={() => toggle(dirs, setDirs, g.id)}>{dirs.includes(g.id) ? '✓ ' : ''}{g.name}</motion.button>
                ))}</div>
              </div>
            </fieldset>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}><GlowButton variant="solid" size="lg" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</GlowButton></div>
        </form>
      )}
    </Modal>
  );
}

// ---------- Padres de familia ----------
function Parents() {
  const toast = useToast();
  const { groups } = useData();
  const st = useAsync(async () => {
    const [parents, kids] = await Promise.all([
      q(supabase.from('profiles').select('*').eq('role', 'parent').order('full_name')),
      q(supabase.from('students').select('id, parent_id, group_id, profile:profiles!students_id_fkey(full_name)')),
    ]);
    return { parents, kids };
  }, []);
  const [edit, setEdit] = useState(null);
  const [pw, setPw] = useState(null);
  const [search, setSearch] = useState('');
  const [link, setLink] = useState(null);
  const del = async (p) => { if (!window.confirm(`¿Eliminar la cuenta de ${p.full_name}? Sus hijos quedarán sin acudiente.`)) return; try { await rpc('cg_admin_delete_user', { uid: p.id }); st.reload(); } catch (e) { toast(e); } };
  const setParent = async (studentId, parentId) => { try { await q(supabase.from('students').update({ parent_id: parentId }).eq('id', studentId)); st.reload(); } catch (e) { toast(e); } };
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <input placeholder="🔎 Buscar acudiente" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
        <span className="spacer" /><GlowButton variant="solid" onClick={() => setEdit({ role: 'parent' })}>＋ Crear padre de familia</GlowButton>
      </div>
      <Async state={st}>{({ parents, kids }) => {
        const list = parents.filter((p) => (p.full_name + (p.doc_id || '') + p.username).toLowerCase().includes(search.toLowerCase()));
        return !list.length ? <Empty icon="👨‍👩‍👧">Sin padres de familia</Empty> : (
          <Stagger className="grid g3">{list.map((p) => {
            const children = kids.filter((k) => k.parent_id === p.id);
            return (
              <StaggerItem key={p.id}>
                <motion.div className="card" whileHover={{ y: -4 }} style={{ height: '100%' }}>
                  <div className="row"><Avatar name={p.full_name} /><div style={{ flex: 1 }}><strong>{p.full_name}</strong><div className="small muted">@{p.username}</div></div></div>
                  <div className="col small" style={{ gap: 2, margin: '10px 0' }}><span>🪪 {p.doc_id || '—'}</span><span>📞 {p.phone || '—'}</span><span>✉️ {p.email || '—'}</span></div>
                  <div className="col" style={{ gap: 4, marginBottom: 10 }}>
                    {children.map((c) => (
                      <div key={c.id} className="row small"><span className="badge info">🎒 {c.profile.full_name} · {groups.find((g) => g.id === c.group_id)?.name || 'sin grupo'}</span>
                        <button className="icon-btn" style={{ width: 24, height: 24 }} title="Desvincular" onClick={() => setParent(c.id, null)}>✕</button></div>
                    ))}
                    {!children.length && <span className="small muted">Sin estudiantes vinculados</span>}
                  </div>
                  <div className="row">
                    <GlowButton size="sm" onClick={() => setEdit({ ...p })}>✎ Editar</GlowButton>
                    <GlowButton size="sm" variant="ghost" onClick={() => setLink(p)}>🔗 Vincular hijo</GlowButton>
                    <GlowButton size="sm" variant="warn" onClick={() => setPw(p)}>🔑</GlowButton>
                    <GlowButton size="sm" variant="bad" onClick={() => del(p)}>✕</GlowButton>
                  </div>
                </motion.div>
              </StaggerItem>
            );
          })}</Stagger>
        );
      }}</Async>
      <UserForm user={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); st.reload(); }} />
      <ResetPassword user={pw} onClose={() => setPw(null)} />
      <Modal open={!!link} onClose={() => setLink(null)} title={`Vincular estudiante a ${link?.full_name || ''}`}>
        <div className="col">
          {(st.data?.kids || []).filter((k) => k.parent_id !== link?.id).sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name)).map((k) => (
            <div key={k.id} className="list-item" style={{ alignItems: 'center' }}>
              <span style={{ flex: 1 }}>{k.profile.full_name} <span className="small muted">{k.parent_id ? '(tiene otro acudiente)' : ''}</span></span>
              <GlowButton size="sm" onClick={async () => { await setParent(k.id, link.id); setLink(null); }}>Vincular</GlowButton>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}

export function ResetPassword({ user, onClose }) {
  const toast = useToast();
  const save = async (e) => {
    e.preventDefault();
    try { await rpc('cg_admin_set_password', { uid: user.id, pw: new FormData(e.target).get('pw') }); toast('Contraseña actualizada'); onClose(); } catch (err) { toast(err); }
  };
  return (
    <Modal open={!!user} onClose={onClose} title={`Asignar contraseña · ${user?.full_name || ''}`}>
      <form className="col" onSubmit={save}>
        <Field label="Nueva contraseña"><input name="pw" type="password" required minLength={4} autoComplete="new-password" /></Field>
        <GlowButton variant="solid" type="submit">Guardar</GlowButton>
      </form>
    </Modal>
  );
}

// ---------- Estudiantes ----------
function Students() {
  const { groups } = useData();
  const toast = useToast();
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState(null);
  const [pw, setPw] = useState(null);
  const st = useAsync(() => q(supabase.from('students').select('*, profile:profiles!students_id_fkey(full_name, username), parent:profiles!students_parent_id_fkey(id, full_name, username, phone, email, doc_id)')), []);
  const allParents = useAsync(() => q(supabase.from('profiles').select('id, full_name, username').eq('role', 'parent').order('full_name')), []);
  const del = async (s) => { if (!window.confirm(`¿Eliminar a ${s.profile.full_name}?`)) return; try { await rpc('cg_admin_delete_user', { uid: s.id }); st.reload(); } catch (e) { toast(e); } };
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <select value={group} onChange={(e) => setGroup(e.target.value)} style={{ width: 'auto' }}><option value="all">Todos los grupos</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <input placeholder="🔎 Buscar por nombre o documento" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
        <span className="spacer" />
        <GlowButton variant="solid" onClick={() => setEdit({})}>＋ Crear estudiante</GlowButton>
      </div>
      <Async state={st}>{(list) => {
        const rows = list.filter((s) => (group === 'all' || s.group_id === group) && (s.profile.full_name + s.doc_id).toLowerCase().includes(search.toLowerCase()))
          .sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name));
        return !rows.length ? <Empty icon="🎒">Sin estudiantes</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Estudiante</th><th>Documento</th><th>Grupo</th><th>Acudiente</th><th>EPS</th><th>Usuario</th><th></th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id}>
                <td><div className="row" style={{ flexWrap: 'nowrap' }}><Avatar name={s.profile.full_name} size={30} />{s.profile.full_name}</div></td>
                <td>{s.doc_id}</td><td>{groups.find((g) => g.id === s.group_id)?.name || '—'}</td>
                <td>{s.parent?.full_name || '—'}<div className="small muted">{s.parent?.username}</div></td><td>{s.eps || '—'}</td><td>{s.profile.username}</td>
                <td><div className="row" style={{ flexWrap: 'nowrap' }}>
                  <GlowButton size="sm" variant="ghost" onClick={() => setEdit(s)}>Editar</GlowButton>
                  <GlowButton size="sm" variant="warn" onClick={() => setPw({ id: s.id, full_name: s.profile.full_name })}>🔑</GlowButton>
                  {s.parent && <GlowButton size="sm" variant="warn" onClick={() => setPw(s.parent)} title="Contraseña del acudiente">🔑👤</GlowButton>}
                  <GlowButton size="sm" variant="bad" onClick={() => del(s)}>✕</GlowButton>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        );
      }}</Async>
      <StudentForm student={edit} parents={allParents.data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); st.reload(); }} />
      <ResetPassword user={pw} onClose={() => setPw(null)} />
    </>
  );
}

export function StudentForm({ student, parents, onClose, onSaved, prefill }) {
  const { groups } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [parentMode, setParentMode] = useState('new');
  const isEdit = !!student?.id;
  const uniqParents = useMemo(() => Object.values(Object.fromEntries((parents || []).map((p) => [p.id, p]))), [parents]);
  const p = prefill || {};
  const g2 = student?.guardian2 || p.guardian2 || {};

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    const f = Object.fromEntries(new FormData(e.target));
    const guardian2 = { name: f.g2name, relation: f.g2relation, doc: f.g2doc, phone: f.g2phone, email: f.g2email, address: f.g2address };
    try {
      if (isEdit) {
        await q(supabase.from('students').update({ group_id: f.group_id || null, doc_id: f.doc, birth_date: f.birth || null, address: f.address, eps: f.eps, clinic: f.clinic, blood_type: f.blood, guardian2, parent_id: f.parent_id || null }).eq('id', student.id));
        await rpc('cg_admin_update_user', { uid: student.id, p_username: f.username, p_full_name: f.name, p_doc: f.doc, p_phone: null, p_email: null });
      } else {
        let parentId = f.parent_existing || null;
        if (parentMode === 'new') {
          parentId = await rpc('cg_admin_create_user', { p_username: f.p_username, p_password: f.p_password, p_role: 'parent', p_full_name: f.p_name, p_doc: f.p_doc, p_phone: f.p_phone, p_email: f.p_email });
        }
        const sid = await rpc('cg_admin_create_user', { p_username: f.username, p_password: f.password, p_role: 'student', p_full_name: f.name, p_doc: f.doc, p_phone: null, p_email: null });
        await q(supabase.from('students').insert({ id: sid, group_id: f.group_id || null, doc_id: f.doc, birth_date: f.birth || null, address: f.address, eps: f.eps, clinic: f.clinic, blood_type: f.blood, parent_id: parentId, guardian2 }));
      }
      toast(isEdit ? 'Estudiante actualizado' : 'Estudiante creado con sus credenciales'); onSaved();
    } catch (err) { toast(err); } finally { setBusy(false); }
  };

  return (
    <Modal open={!!student} onClose={onClose} title={isEdit ? 'Editar estudiante' : 'Crear estudiante'} wide>
      {student && (
        <form className="col" onSubmit={submit}>
          <fieldset><legend>🎒 Estudiante</legend>
            <Field label="Nombre completo"><input name="name" required defaultValue={student.profile?.full_name || p.student_name} /></Field>
            <Field label="Documento (TI / RC / CC)"><input name="doc" required defaultValue={student.doc_id || p.student_doc} /></Field>
            <Field label="Fecha de nacimiento"><input name="birth" type="date" defaultValue={student.birth_date || p.birth_date} /></Field>
            <Field label="Dirección"><input name="address" defaultValue={student.address || p.address} /></Field>
            <Field label="Grupo / grado"><select name="group_id" defaultValue={student.group_id || ''}><option value="">Sin asignar</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
            <Field label="Usuario del estudiante"><input name="username" required pattern="[a-zA-Z0-9._\-]{3,40}" autoComplete="off" defaultValue={student.profile?.username} /></Field>
            {!isEdit && <Field label="Contraseña del estudiante"><input name="password" type="password" required minLength={4} autoComplete="new-password" /></Field>}
            {isEdit && <Field label="Acudiente principal"><select name="parent_id" defaultValue={student.parent_id || ''}><option value="">Sin acudiente</option>{uniqParents.map((x) => <option key={x.id} value={x.id}>{x.full_name} (@{x.username})</option>)}</select></Field>}
          </fieldset>
          <fieldset><legend>🏥 Salud</legend>
            <Field label="EPS o seguro médico al que está afiliado"><input name="eps" list="eps-admin" defaultValue={student.eps || p.eps} /><datalist id="eps-admin">{EPS.map((x) => <option key={x} value={x} />)}</datalist></Field>
            <Field label="Clínica o centro médico de traslado (opcional)"><input name="clinic" defaultValue={student.clinic || p.clinic} /></Field>
            <Field label="Grupo sanguíneo"><select name="blood" defaultValue={student.blood_type || ''}><option value="">—</option>{['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          </fieldset>
          {!isEdit && (
            <fieldset><legend>👤 Padre de familia / acudiente principal</legend>
              <div className="full"><Tabs tabs={[{ key: 'new', label: 'Crear cuenta nueva' }, { key: 'existing', label: 'Acudiente existente' }]} value={parentMode} onChange={setParentMode} /></div>
              {parentMode === 'existing' ? (
                <Field label="Acudiente" className="full"><select name="parent_existing" required><option value="">Seleccione…</option>{uniqParents.map((x) => <option key={x.id} value={x.id}>{x.full_name} (@{x.username})</option>)}</select></Field>
              ) : <>
                <Field label="Nombre completo"><input name="p_name" required defaultValue={p.parent_name} /></Field>
                <Field label="Documento"><input name="p_doc" defaultValue={p.parent_doc} /></Field>
                <Field label="Teléfono"><input name="p_phone" type="tel" defaultValue={p.parent_phone} /></Field>
                <Field label="Correo"><input name="p_email" type="email" defaultValue={p.parent_email} /></Field>
                <Field label="Usuario del acudiente"><input name="p_username" required pattern="[a-zA-Z0-9._\-]{3,40}" autoComplete="off" /></Field>
                <Field label="Contraseña del acudiente"><input name="p_password" type="password" required minLength={4} autoComplete="new-password" /></Field>
              </>}
            </fieldset>
          )}
          <fieldset><legend>👥 Segundo responsable (contacto)</legend>
            <Field label="Nombre"><input name="g2name" defaultValue={g2.name} /></Field>
            <Field label="Parentesco"><input name="g2relation" defaultValue={g2.relation} /></Field>
            <Field label="Documento"><input name="g2doc" defaultValue={g2.doc} /></Field>
            <Field label="Teléfono"><input name="g2phone" type="tel" defaultValue={g2.phone} /></Field>
            <Field label="Correo"><input name="g2email" type="email" defaultValue={g2.email} /></Field>
            <Field label="Dirección"><input name="g2address" defaultValue={g2.address} /></Field>
          </fieldset>
          <div className="row" style={{ justifyContent: 'flex-end' }}><GlowButton variant="solid" size="lg" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</GlowButton></div>
        </form>
      )}
    </Modal>
  );
}
