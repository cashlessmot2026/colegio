import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Shell from '../components/Shell.jsx';
import Chat from '../components/Chat.jsx';
import VirtualClass from '../components/VirtualClass.jsx';
import { ScheduleGrid, EventsList } from '../components/Common.jsx';
import { useAuth, useData, scaleOf } from '../context.jsx';
import { supabase, q, rpc, upload, openFile } from '../lib/supabase.js';
import { SCALES, getScale, weightedAverage, fmt, PERIODS, levelFor } from '../lib/grading.js';
import { fmtDate, fmtDateTime, fmtTime, todayISO, weekStart, toISO, addDays, currentBlock, monthLabel } from '../lib/dates.js';
import { makePdf } from '../lib/pdf.js';
import {
  Card, Tabs, GlowButton, Empty, Spinner, Field, Modal, Stagger, StaggerItem, Progress, GradeBadge, Kpi, useToast, Avatar, useAsync, Async,
} from '../components/ui.jsx';

const NAV = [
  { key: 'inicio', label: 'Inicio', icon: '🏠' },
  { key: 'asistencia', label: 'Asistencia', icon: '✅' },
  { key: 'reportes', label: 'Reportes', icon: '📄' },
  { key: 'asignaturas', label: 'Asignaturas', icon: '📚' },
  { key: 'direccion', label: 'Mi grupo', icon: '🧭' },
  { key: 'clase', label: 'Clase virtual', icon: '🎥' },
  { key: 'agenda', label: 'Actividades', icon: '🚌' },
  { key: 'horario', label: 'Horario', icon: '⏰' },
  { key: 'chat', label: 'Chat', icon: '💬' },
];

export default function Teacher() {
  const { profile } = useAuth();
  const { subjects, schedule, groups } = useData();
  const [tab, setTab] = useState('inicio');
  const [students, setStudents] = useState(null);
  const mySubjects = useMemo(() => subjects.filter((s) => s.teacher_id === profile.id), [subjects, profile.id]);
  const myBlocks = useMemo(() => schedule.filter((b) => mySubjects.some((s) => s.id === b.subject_id)), [schedule, mySubjects]);
  const directed = groups.filter((g) => g.director_id === profile.id);
  const myGroupIds = useMemo(() => [...new Set([...mySubjects.map((s) => s.group_id), ...directed.map((g) => g.id)])], [mySubjects, directed]);

  useEffect(() => {
    if (!myGroupIds.length) { setStudents([]); return; }
    q(supabase.from('students').select('*, profile:profiles!students_id_fkey(full_name, username), parent:profiles!students_parent_id_fkey(full_name, phone, email)').in('group_id', myGroupIds))
      .then((s) => setStudents(s.sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name)))).catch(() => setStudents([]));
  }, [myGroupIds.join()]); // eslint-disable-line

  const ctx = { mySubjects, myBlocks, directed, students: students || [], myGroupIds, go: setTab };
  return (
    <Shell nav={NAV.filter((n) => n.key !== 'direccion' || directed.length)} active={tab} onNav={setTab} title={NAV.find((n) => n.key === tab)?.label}
      subtitle={`${profile.full_name}${directed.length ? ' · Director(a) de ' + directed.map((g) => g.name).join(', ') : ''}`}>
      {!students ? <Spinner /> : (
        <>
          {tab === 'inicio' && <Home {...ctx} />}
          {tab === 'asistencia' && <TakeAttendance {...ctx} />}
          {tab === 'reportes' && <AttendanceReport {...ctx} />}
          {tab === 'asignaturas' && <SubjectsView {...ctx} />}
          {tab === 'direccion' && <DirectorView {...ctx} />}
          {tab === 'clase' && <TeacherClass {...ctx} />}
          {tab === 'agenda' && <TeacherEvents {...ctx} />}
          {tab === 'horario' && <Card><ScheduleGrid blocks={myBlocks} showGroup /></Card>}
          {tab === 'chat' && <Chat />}
        </>
      )}
    </Shell>
  );
}

function Home({ mySubjects, myBlocks, directed, students, go }) {
  const { subjectById, roomById, groupById } = useData();
  const now = currentBlock(myBlocks);
  const st = useAsync(() => q(supabase.from('topics').select('subject_id, done').in('subject_id', mySubjects.map((s) => s.id).concat('00000000-0000-0000-0000-000000000000'))), []);
  const progress = st.data?.length ? (100 * st.data.filter((t) => t.done).length) / st.data.length : null;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g4">
        <Kpi icon="📚" label="Asignaturas" value={mySubjects.length} />
        <Kpi icon="🎒" label="Estudiantes" value={students.length} delay={0.05} />
        <Kpi icon="⏰" label="Bloques semanales" value={myBlocks.length} delay={0.1} />
        <Kpi icon="🗓️" label="Avance cronograma" value={progress} suffix="%" delay={0.15} />
      </div>
      <Card glow title="Clase actual">
        {now ? (
          <div className="row">
            <span style={{ fontSize: 40 }}>🏫</span>
            <div style={{ flex: 1 }}>
              <h2>{subjectById[now.subject_id]?.name} · {groupById[now.group_id]?.name}</h2>
              <p className="muted">{roomById[now.room_id]?.name} · {fmtTime(now.start_time)}–{fmtTime(now.end_time)}</p>
            </div>
            <GlowButton variant="solid" onClick={() => go('asistencia')}>✅ Tomar asistencia</GlowButton>
          </div>
        ) : <p className="muted">No tiene clase en este momento.</p>}
      </Card>
      {directed.length > 0 && (
        <Card title="Dirección de grupo">
          {directed.map((g) => <div key={g.id} className="row"><span className="badge info">{g.name}</span><span className="muted small">{students.filter((s) => s.group_id === g.id).length} estudiantes</span><span className="spacer" /><GlowButton size="sm" onClick={() => go('direccion')}>Abrir</GlowButton></div>)}
        </Card>
      )}
    </div>
  );
}

// ---------- Tomar asistencia: aparecen los estudiantes del grupo que está en el salón en ese bloque ----------
const STATUSES = [['presente', '✅', 'ok'], ['ausente', '🚨', 'bad'], ['tarde', '⏰', 'warn'], ['excusa', '📄', '']];

function TakeAttendance({ myBlocks, mySubjects, students }) {
  const { profile } = useAuth();
  const toast = useToast();
  const { subjectById, roomById, groupById } = useData();
  const now = currentBlock(myBlocks);
  const [subjectId, setSubjectId] = useState(now?.subject_id || mySubjects[0]?.id || '');
  const [date, setDate] = useState(todayISO());
  const [marks, setMarks] = useState({});
  const [notes, setNotes] = useState({});
  const [saving, setSaving] = useState(false);
  const subject = subjectById[subjectId];
  const list = students.filter((s) => s.group_id === subject?.group_id);
  const block = myBlocks.find((b) => b.subject_id === subjectId && b.day === new Date(date + 'T12:00').getDay());

  useEffect(() => {
    if (!subjectId) return;
    q(supabase.from('attendance').select('*').eq('subject_id', subjectId).eq('date', date)).then((rows) => {
      setMarks(Object.fromEntries(rows.map((r) => [r.student_id, r.status])));
      setNotes(Object.fromEntries(rows.map((r) => [r.student_id, r.note || ''])));
    });
  }, [subjectId, date]);

  const save = async () => {
    setSaving(true);
    try {
      const rows = list.map((s) => ({ student_id: s.id, subject_id: subjectId, date, status: marks[s.id] || 'presente', note: notes[s.id] || null, teacher_id: profile.id }));
      await q(supabase.from('attendance').upsert(rows, { onConflict: 'student_id,subject_id,date' }));
      const abs = rows.filter((r) => r.status === 'ausente').length;
      toast(`Asistencia guardada${abs ? ` · ${abs} inasistencia(s) notificadas al acudiente, director de grupo y colegio` : ''}`);
      setMarks(Object.fromEntries(rows.map((r) => [r.student_id, r.status])));
    } catch (e) { toast(e); } finally { setSaving(false); }
  };

  if (!mySubjects.length) return <Empty icon="📚">No tiene asignaturas asignadas</Empty>;
  return (
    <Card glow title="Lista de asistencia" actions={
      <div className="row">
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={{ width: 'auto' }}>
          {mySubjects.map((s) => <option key={s.id} value={s.id}>{s.name} · {groupById[s.group_id]?.name}</option>)}
        </select>
        <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} style={{ width: 'auto' }} />
      </div>}>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="badge info">🏫 {block ? roomById[block.room_id]?.name : 'Sin bloque este día'}</span>
        <span className="badge">{groupById[subject?.group_id]?.name} · {list.length} estudiantes</span>
        <span className="spacer" />
        <GlowButton size="sm" variant="ok" onClick={() => setMarks(Object.fromEntries(list.map((s) => [s.id, 'presente'])))}>Todos presentes</GlowButton>
      </div>
      {list.length === 0 ? <Empty icon="🎒">No hay estudiantes en este grupo</Empty> : (
        <Stagger>
          {list.map((s) => (
            <StaggerItem key={s.id} className="list-item" style={{ alignItems: 'center' }}>
              <Avatar name={s.profile.full_name} size={36} />
              <strong style={{ flex: 1, minWidth: 140 }}>{s.profile.full_name}</strong>
              <div className="row" style={{ gap: 6 }}>
                {STATUSES.map(([k, ico, v]) => (
                  <motion.button key={k} whileTap={{ scale: 0.85 }} className={`gbtn sm ${(marks[s.id] || 'presente') === k ? 'solid ' + v : 'ghost'}`} onClick={() => setMarks({ ...marks, [s.id]: k })} title={k}>{ico} <span className="small">{k}</span></motion.button>
                ))}
              </div>
              <input placeholder="Observación" value={notes[s.id] || ''} onChange={(e) => setNotes({ ...notes, [s.id]: e.target.value })} style={{ maxWidth: 200 }} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <GlowButton variant="solid" size="lg" onClick={save} disabled={saving || !list.length}>{saving ? 'Guardando…' : '💾 Guardar asistencia'}</GlowButton>
      </div>
    </Card>
  );
}

// ---------- Reporte PDF de asistencia por día o mes ----------
function AttendanceReport({ mySubjects, students, directed }) {
  const { school, subjectById, groupById } = useData();
  const toast = useToast();
  const [mode, setMode] = useState('dia');
  const [day, setDay] = useState(todayISO());
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [subjectId, setSubjectId] = useState('all');
  const [rows, setRows] = useState(null);
  const subjectIds = mySubjects.map((s) => s.id);

  const load = async () => {
    let qq = supabase.from('attendance').select('*').order('date');
    if (subjectId !== 'all') qq = qq.eq('subject_id', subjectId);
    else qq = qq.in('subject_id', subjectIds.length ? subjectIds : ['00000000-0000-0000-0000-000000000000']);
    if (mode === 'dia') qq = qq.eq('date', day);
    else { const [y, m] = month.split('-').map(Number); qq = qq.gte('date', `${month}-01`).lte('date', toISO(new Date(y, m, 0))); }
    try { setRows(await q(qq)); } catch (e) { toast(e); }
  };
  useEffect(() => { load(); }, [mode, day, month, subjectId]); // eslint-disable-line

  const name = (id) => students.find((s) => s.id === id)?.profile.full_name || '—';
  const summary = useMemo(() => {
    if (!rows) return [];
    const m = {};
    for (const r of rows) { m[r.student_id] ??= { presente: 0, ausente: 0, tarde: 0, excusa: 0 }; m[r.student_id][r.status]++; }
    return Object.entries(m).map(([id, c]) => ({ id, name: name(id), ...c })).sort((a, b) => b.ausente - a.ausente);
  }, [rows]); // eslint-disable-line

  const pdf = () => {
    const period = mode === 'dia' ? fmtDate(day) : monthLabel(month);
    const sub = subjectId === 'all' ? 'Todas mis asignaturas' : `${subjectById[subjectId]?.name} · ${groupById[subjectById[subjectId]?.group_id]?.name}`;
    if (mode === 'dia') {
      makePdf({ school: school.name, title: `Reporte de asistencia · ${period}`, subtitle: sub,
        head: ['Estudiante', 'Asignatura', 'Grupo', 'Estado', 'Observación'],
        body: rows.map((r) => [name(r.student_id), subjectById[r.subject_id]?.name, groupById[subjectById[r.subject_id]?.group_id]?.name, r.status, r.note || '']),
        filename: `asistencia-${day}.pdf` });
    } else {
      makePdf({ school: school.name, title: `Reporte mensual de asistencia · ${period}`, subtitle: sub,
        head: ['Estudiante', 'Presente', 'Ausente', 'Tarde', 'Excusa', '% Asistencia'],
        body: summary.map((s) => { const t = s.presente + s.ausente + s.tarde + s.excusa; return [s.name, s.presente, s.ausente, s.tarde, s.excusa, t ? Math.round((100 * (t - s.ausente)) / t) + '%' : '—']; }),
        filename: `asistencia-${month}.pdf` });
    }
  };

  return (
    <Card glow title="Reporte de asistencia" actions={<GlowButton variant="ok" onClick={pdf} disabled={!rows?.length}>⬇ Generar PDF</GlowButton>}>
      <Tabs tabs={[{ key: 'dia', label: 'Por día' }, { key: 'mes', label: 'Por mes' }]} value={mode} onChange={setMode} />
      <div className="row" style={{ marginBottom: 14 }}>
        {mode === 'dia' ? <input type="date" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: 'auto' }} /> : <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} />}
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">Todas mis asignaturas</option>
          {mySubjects.map((s) => <option key={s.id} value={s.id}>{s.name} · {groupById[s.group_id]?.name}</option>)}
        </select>
      </div>
      {!rows ? <Spinner /> : !rows.length ? <Empty icon="📄">Sin registros en el periodo</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Estudiante</th><th>Presente</th><th>Ausente</th><th>Tarde</th><th>Excusa</th></tr></thead>
          <tbody>{summary.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.presente}</td><td style={{ color: s.ausente ? 'var(--bad)' : undefined }}>{s.ausente}</td><td>{s.tarde}</td><td>{s.excusa}</td></tr>)}</tbody>
        </table></div>
      )}
    </Card>
  );
}

// ---------- Asignaturas: tareas + notas + material + cronograma ----------
function SubjectsView({ mySubjects, students }) {
  const { groupById } = useData();
  const [open, setOpen] = useState(null);
  if (!mySubjects.length) return <Empty icon="📚">El colegio aún no le ha asignado asignaturas</Empty>;
  const subject = mySubjects.find((s) => s.id === open);
  return (
    <AnimatePresence mode="wait">
      {subject ? (
        <motion.div key="detail" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}>
          <SubjectDetail subject={subject} students={students.filter((s) => s.group_id === subject.group_id)} onBack={() => setOpen(null)} />
        </motion.div>
      ) : (
        <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -40 }}>
          <Stagger className="grid g3">
            {mySubjects.map((s) => (
              <StaggerItem key={s.id}>
                <motion.div className="card" whileHover={{ y: -6, boxShadow: `0 0 34px ${s.color}66` }} style={{ cursor: 'pointer', borderTop: `4px solid ${s.color}` }} onClick={() => setOpen(s.id)}>
                  <h3>{s.name}</h3>
                  <p className="muted small">{groupById[s.group_id]?.name} · {students.filter((x) => x.group_id === s.group_id).length} estudiantes</p>
                  <div className="row" style={{ marginTop: 12 }}><span className="badge">Escala {s.scale || 'institucional'}</span><span className="spacer" /><span>→</span></div>
                </motion.div>
              </StaggerItem>
            ))}
          </Stagger>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SubjectDetail({ subject, students, onBack }) {
  const { groupById, grading, reload } = useData();
  const toast = useToast();
  const [tab, setTab] = useState('notas');
  const [period, setPeriod] = useState(1);
  const scale = scaleOf(subject, grading);
  const tasksSt = useAsync(() => q(supabase.from('tasks').select('*').eq('subject_id', subject.id).order('created_at')), [subject.id]);
  const gradesSt = useAsync(async () => {
    const ids = (tasksSt.data || []).map((t) => t.id);
    return ids.length ? q(supabase.from('grades').select('*').in('task_id', ids)) : [];
  }, [tasksSt.data]);
  const [taskModal, setTaskModal] = useState(null);

  const setScale = async (v) => {
    try { await q(supabase.from('subjects').update({ scale: v || null }).eq('id', subject.id)); await reload(); toast('Escala actualizada'); } catch (e) { toast(e); }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row">
        <GlowButton size="sm" variant="ghost" onClick={onBack}>← Volver</GlowButton>
        <h2 style={{ flex: 1 }}><span style={{ color: subject.color }}>●</span> {subject.name} · {groupById[subject.group_id]?.name}</h2>
        {grading.teacher_can_choose && (
          <select value={subject.scale || ''} onChange={(e) => setScale(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Escala institucional ({grading.scale})</option>
            {Object.values(SCALES).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
      </div>
      <Tabs tabs={[{ key: 'notas', label: '📊 Tareas y notas' }, { key: 'cronograma', label: '🗓️ Cronograma por temas' }]} value={tab} onChange={setTab} />
      {tab === 'notas' && (
        <>
          <div className="row">
            <Tabs tabs={PERIODS.map((p) => ({ key: p, label: `Periodo ${p}` }))} value={period} onChange={setPeriod} />
            <span className="spacer" />
            <GlowButton variant="solid" onClick={() => setTaskModal({ subject_id: subject.id, period, kind: 'tarea', weight: 1, files: [] })}>＋ Nueva tarea</GlowButton>
          </div>
          <Async state={tasksSt}>{(tasks) => (
            <GradeGrid tasks={tasks.filter((t) => t.period === period)} grades={gradesSt.data || []} students={students} scale={scale}
              onEditTask={setTaskModal} onSaved={gradesSt.reload} />
          )}</Async>
        </>
      )}
      {tab === 'cronograma' && <TopicsEditor subject={subject} />}
      <TaskModal task={taskModal} onClose={() => setTaskModal(null)} onSaved={() => { setTaskModal(null); tasksSt.reload(); }} />
      <div className="small muted">Escala: {getScale(scale).label} · {getScale(scale).levels.map((l) => `${l.name} ${l.from}–${l.to}`).join(' · ')}</div>
    </div>
  );
}

function GradeGrid({ tasks, grades, students, scale, onEditTask, onSaved }) {
  const toast = useToast();
  const sc = getScale(scale);
  const init = () => Object.fromEntries(grades.map((g) => [`${g.task_id}|${g.student_id}`, g.value ?? '']));
  const [vals, setVals] = useState(init);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setVals(init()); setDirty(false); }, [grades]); // eslint-disable-line
  const toastF = useToast();

  const save = async () => {
    const rows = [];
    for (const [k, v] of Object.entries(vals)) {
      if (v === '' || v == null) continue;
      const n = Number(String(v).replace(',', '.'));
      if (Number.isNaN(n) || n < sc.min || n > sc.max) return toast(new Error(`Nota fuera de la escala (${sc.min} a ${sc.max})`));
      const [task_id, student_id] = k.split('|');
      if (tasks.some((t) => t.id === task_id)) rows.push({ task_id, student_id, value: n, updated_at: new Date().toISOString() });
    }
    try { await q(supabase.from('grades').upsert(rows, { onConflict: 'task_id,student_id' })); toastF('Notas guardadas'); setDirty(false); onSaved(); } catch (e) { toast(e); }
  };

  if (!tasks.length) return <Empty icon="📝">No hay tareas en este periodo. Cree la primera con “Nueva tarea”.</Empty>;
  return (
    <Card>
      <div className="table-wrap"><table>
        <thead><tr><th>Estudiante</th>
          {tasks.map((t) => <th key={t.id} style={{ cursor: 'pointer' }} onClick={() => onEditTask(t)} title="Editar tarea">{t.title.slice(0, 18)} ✎<div style={{ textTransform: 'none' }}>{t.kind} · peso {t.weight}{t.files?.length ? ` · 📎${t.files.length}` : ''}</div></th>)}
          <th>Promedio</th></tr></thead>
        <tbody>{students.map((s) => {
          const avg = weightedAverage(tasks.map((t) => ({ value: vals[`${t.id}|${s.id}`] === '' ? null : vals[`${t.id}|${s.id}`], weight: t.weight })));
          return (
            <tr key={s.id}><td>{s.profile.full_name}</td>
              {tasks.map((t) => {
                const k = `${t.id}|${s.id}`; const l = levelFor(vals[k] === '' ? null : vals[k], scale);
                return <td key={t.id}><input type="number" step={sc.step} min={sc.min} max={sc.max} value={vals[k] ?? ''} style={{ width: 80, borderColor: l?.color }}
                  onChange={(e) => { setVals({ ...vals, [k]: e.target.value }); setDirty(true); }} /></td>;
              })}
              <td><GradeBadge value={avg} scale={scale} /></td></tr>
          );
        })}</tbody>
      </table></div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <AnimatePresence>{dirty && <motion.span className="badge warn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Cambios sin guardar</motion.span>}</AnimatePresence>
        <GlowButton variant="solid" onClick={save}>💾 Guardar notas</GlowButton>
      </div>
    </Card>
  );
}

function TaskModal({ task, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(task);
  const [newFiles, setNewFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(task); setNewFiles([]); }, [task]);
  if (!task) return <Modal open={false} />;
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const uploaded = [];
      for (const file of newFiles) uploaded.push(await upload('colegio-tareas', file, f.subject_id));
      const row = { subject_id: f.subject_id, title: f.title, description: f.description, kind: f.kind, period: Number(f.period), due_date: f.due_date || null, weight: Number(f.weight) || 1, files: [...(f.files || []), ...uploaded] };
      if (f.id) await q(supabase.from('tasks').update(row).eq('id', f.id)); else await q(supabase.from('tasks').insert(row));
      toast('Tarea guardada'); onSaved();
    } catch (err) { toast(err); } finally { setBusy(false); }
  };
  const del = async () => { if (!confirmDelete()) return; await supabase.from('tasks').delete().eq('id', f.id); onSaved(); };
  return (
    <Modal open={!!task} onClose={onClose} title={f?.id ? 'Editar tarea' : 'Nueva tarea'}>
      {f && (
        <form className="form" onSubmit={save}>
          <Field label="Título" className="full"><input required value={f.title || ''} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Tipo"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['tarea', 'examen', 'taller', 'proyecto'].map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Periodo"><select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>{PERIODS.map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Fecha de entrega"><input type="date" value={f.due_date || ''} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label="Peso (ponderación)"><input type="number" min="0.1" step="0.1" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} /></Field>
          <Field label="Descripción / instrucciones" className="full"><textarea value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Guías y material de apoyo (PDF, documentos)" className="full"><input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/*" onChange={(e) => setNewFiles([...e.target.files])} /></Field>
          {(f.files || []).length > 0 && (
            <div className="full col" style={{ gap: 4 }}>
              {f.files.map((x) => (
                <div key={x.path} className="row small">
                  <a href="#" onClick={(e) => { e.preventDefault(); openFile('colegio-tareas', x.path, x.name).catch(toast); }}>📎 {x.name}</a>
                  <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => setF({ ...f, files: f.files.filter((y) => y.path !== x.path) })}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="full row" style={{ justifyContent: 'flex-end' }}>
            {f.id && <GlowButton type="button" variant="bad" onClick={del}>Eliminar</GlowButton>}
            <GlowButton variant="solid" type="submit" disabled={busy}>{busy ? 'Subiendo…' : 'Guardar'}</GlowButton>
          </div>
        </form>
      )}
    </Modal>
  );
}
const confirmDelete = () => window.confirm('¿Eliminar definitivamente? Esta acción no se puede deshacer.');

function TopicsEditor({ subject }) {
  const toast = useToast();
  const st = useAsync(() => q(supabase.from('topics').select('*').eq('subject_id', subject.id).order('week_start')), [subject.id]);
  const [f, setF] = useState({ week_start: toISO(weekStart()), title: '', description: '' });
  const add = async (e) => {
    e.preventDefault();
    try { await q(supabase.from('topics').insert({ ...f, week_start: toISO(weekStart(new Date(f.week_start + 'T12:00'))), subject_id: subject.id })); setF({ ...f, title: '', description: '' }); st.reload(); } catch (err) { toast(err); }
  };
  const toggle = async (t) => { await supabase.from('topics').update({ done: !t.done }).eq('id', t.id); st.reload(); };
  const del = async (t) => { await supabase.from('topics').delete().eq('id', t.id); st.reload(); };
  const list = st.data || [];
  const pct = list.length ? (100 * list.filter((t) => t.done).length) / list.length : 0;
  return (
    <div className="grid g2">
      <Card glow title="Agregar tema al cronograma">
        <form className="col" onSubmit={add}>
          <Field label="Semana (cualquier día de la semana)"><input type="date" value={f.week_start} onChange={(e) => setF({ ...f, week_start: e.target.value })} required /></Field>
          <Field label="Tema"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
          <Field label="Actividades / descripción"><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <GlowButton variant="solid" type="submit">＋ Agregar</GlowButton>
        </form>
      </Card>
      <Card title={`Cronograma · avance ${Math.round(pct)}%`}>
        <Progress value={pct} />
        <div style={{ marginTop: 14 }}>
          {!list.length ? <Empty icon="🗓️">Sin temas</Empty> : (
            <Stagger>{list.map((t) => (
              <StaggerItem key={t.id} className="list-item">
                <motion.button whileTap={{ scale: 0.8 }} className="icon-btn" onClick={() => toggle(t)} style={t.done ? { borderColor: 'var(--ok)', boxShadow: '0 0 12px rgba(61,220,151,.5)' } : undefined}>{t.done ? '✅' : '⬜'}</motion.button>
                <div style={{ flex: 1 }}><strong style={{ textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</strong><div className="small muted">Semana del {fmtDate(t.week_start)}</div>{t.description && <p className="small">{t.description}</p>}</div>
                <button className="icon-btn" onClick={() => del(t)}>🗑</button>
              </StaggerItem>
            ))}</Stagger>
          )}
        </div>
      </Card>
    </div>
  );
}

// ---------- Director de grupo ----------
function DirectorView({ directed, students }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [gid, setGid] = useState(directed[0]?.id);
  const list = students.filter((s) => s.group_id === gid);
  const att = useAsync(() => q(supabase.from('attendance').select('student_id, status, date, subject_id').in('student_id', list.map((s) => s.id).concat('00000000-0000-0000-0000-000000000000'))), [gid, list.length]);
  const exits = useAsync(() => q(supabase.from('exit_permissions').select('*').in('student_id', list.map((s) => s.id).concat('00000000-0000-0000-0000-000000000000')).order('created_at', { ascending: false }).limit(40)), [gid, list.length]);
  const [detail, setDetail] = useState(null);
  const [exitFor, setExitFor] = useState(null);
  const absences = (id) => (att.data || []).filter((a) => a.student_id === id && a.status === 'ausente').length;

  const authorize = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await q(supabase.from('exit_permissions').insert({ student_id: exitFor.id, requested_by: profile.id, requester_role: 'director', reason: fd.get('reason'), pickup_person: fd.get('pickup'), valid_date: fd.get('date') }));
      toast('Salida autorizada'); setExitFor(null); exits.reload();
    } catch (err) { toast(err); }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      {directed.length > 1 && <Tabs tabs={directed.map((g) => ({ key: g.id, label: g.name }))} value={gid} onChange={setGid} />}
      <div className="grid g2">
        <Card glow title={`Estudiantes (${list.length})`}>
          <Stagger>{list.map((s) => (
            <StaggerItem key={s.id} className="list-item" style={{ alignItems: 'center' }}>
              <Avatar name={s.profile.full_name} size={36} />
              <div style={{ flex: 1 }}><strong>{s.profile.full_name}</strong><div className="small muted">Acudiente: {s.parent?.full_name || '—'} {s.parent?.phone ? '· ' + s.parent.phone : ''}</div></div>
              {absences(s.id) > 0 && <span className="badge bad">{absences(s.id)} inasist.</span>}
              <GlowButton size="sm" variant="ghost" onClick={() => setDetail(s)}>Ficha</GlowButton>
              <GlowButton size="sm" variant="warn" onClick={() => setExitFor(s)}>🚪</GlowButton>
            </StaggerItem>
          ))}</Stagger>
        </Card>
        <Card title="Salidas autorizadas recientes">
          <Async state={exits}>{(rows) => !rows.length ? <Empty icon="🚪">Sin salidas</Empty> : rows.map((e) => (
            <div key={e.id} className="list-item" style={{ marginBottom: 6 }}>
              <span>{e.status === 'usada' ? '✅' : e.status === 'revocada' ? '⛔' : '🟢'}</span>
              <div style={{ flex: 1 }}><strong>{list.find((s) => s.id === e.student_id)?.profile.full_name}</strong><div className="small muted">{fmtDate(e.valid_date)} · {e.reason} · por {e.requester_role === 'parent' ? 'acudiente' : e.requester_role}</div>
                {e.lat && <a className="small" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${e.lat},${e.lng}`}>📍 Ubicación de la solicitud</a>}</div>
            </div>
          ))}</Async>
        </Card>
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Ficha del estudiante">
        {detail && (
          <div className="col">
            <div className="row"><Avatar name={detail.profile.full_name} size={54} /><div><h3>{detail.profile.full_name}</h3><span className="small muted">Doc. {detail.doc_id} · Usuario {detail.profile.username}</span></div></div>
            <div className="grid g2">
              <div className="card"><strong>🏥 Salud</strong><p className="small">EPS: {detail.eps || '—'}</p><p className="small">Clínica de traslado: {detail.clinic || '—'}</p><p className="small">RH: {detail.blood_type || '—'}</p></div>
              <div className="card"><strong>👤 Acudiente</strong><p className="small">{detail.parent?.full_name || '—'}</p><p className="small">{detail.parent?.phone} {detail.parent?.email}</p></div>
              <div className="card"><strong>👥 Segundo responsable</strong><p className="small">{detail.guardian2?.name || '—'} {detail.guardian2?.relation ? `(${detail.guardian2.relation})` : ''}</p><p className="small">{detail.guardian2?.phone} {detail.guardian2?.email}</p></div>
              <div className="card"><strong>🚨 Inasistencias</strong><p style={{ fontSize: '1.8rem', fontWeight: 800 }}>{absences(detail.id)}</p></div>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!exitFor} onClose={() => setExitFor(null)} title={`Autorizar salida · ${exitFor?.profile.full_name || ''}`}>
        <form className="col" onSubmit={authorize}>
          <Field label="Fecha"><input name="date" type="date" defaultValue={todayISO()} min={todayISO()} required /></Field>
          <Field label="Motivo"><input name="reason" required /></Field>
          <Field label="Persona que recoge"><input name="pickup" required /></Field>
          <GlowButton variant="solid" type="submit">Autorizar</GlowButton>
        </form>
      </Modal>
    </div>
  );
}

// ---------- Clase virtual (docente) ----------
function TeacherClass({ mySubjects, students }) {
  const toast = useToast();
  const { groupById } = useData();
  const [subjectId, setSubjectId] = useState(mySubjects[0]?.id || '');
  const [session, setSession] = useState(null);
  const subject = mySubjects.find((s) => s.id === subjectId);
  const start = async () => {
    try {
      const [s] = await rpc('cg_start_class', { p_group: subject.group_id, p_subject: subject.id });
      setSession({ ...s, subject: `${subject.name} · ${groupById[subject.group_id]?.name}` });
    } catch (e) { toast(e); }
  };
  if (session) return <VirtualClass role="teacher" session={session} roster={students.filter((s) => s.group_id === subject.group_id).map((s) => ({ id: s.id, name: s.profile.full_name }))} onExit={() => setSession(null)} />;
  if (!mySubjects.length) return <Empty icon="🎥">No tiene asignaturas asignadas</Empty>;
  return (
    <Card glow>
      <div className="col" style={{ alignItems: 'center', textAlign: 'center', padding: 20 }}>
        <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 2.4 }} style={{ fontSize: 70, filter: 'drop-shadow(0 0 20px #7c5cff)' }}>🎥</motion.div>
        <h2>Iniciar clase virtual</h2>
        <p className="muted">Se generará un código de 4 dígitos. Solo los estudiantes del salón podrán entrar, una conexión por estudiante.</p>
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={{ maxWidth: 360 }}>
          {mySubjects.map((s) => <option key={s.id} value={s.id}>{s.name} · {groupById[s.group_id]?.name}</option>)}
        </select>
        <GlowButton variant="solid" size="lg" onClick={start}>▶ Iniciar y generar código</GlowButton>
      </div>
    </Card>
  );
}

// ---------- Actividades / salidas pedagógicas ----------
export function EventForm({ event, groups, onClose, onSaved, allowAllSchool }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [f, setF] = useState(event);
  useEffect(() => setF(event), [event]);
  const save = async (e) => {
    e.preventDefault();
    const row = { ...f, cost: f.cost === '' || f.cost == null ? null : Number(f.cost), group_id: f.group_id || null, ends_at: f.ends_at || null, created_by: f.created_by || profile.id };
    try {
      if (f.id) await q(supabase.from('events').update(row).eq('id', f.id)); else await q(supabase.from('events').insert(row));
      toast('Actividad guardada'); onSaved();
    } catch (err) { toast(err); }
  };
  const del = async () => { if (!confirmDelete()) return; await supabase.from('events').delete().eq('id', f.id); onSaved(); };
  const local = (v) => (v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  return (
    <Modal open={!!event} onClose={onClose} title={f?.id ? 'Editar actividad' : 'Nueva actividad'}>
      {f && (
        <form className="form" onSubmit={save}>
          <Field label="Título" className="full"><input required value={f.title || ''} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Tipo"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="salida">Salida pedagógica</option><option value="evento">Evento</option><option value="reunion">Reunión</option><option value="academico">Académico</option></select></Field>
          <Field label="Grupo"><select value={f.group_id || ''} onChange={(e) => setF({ ...f, group_id: e.target.value })} required={!allowAllSchool}>
            {allowAllSchool ? <option value="">Todo el colegio</option> : <option value="">Seleccione…</option>}
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
          <Field label="Inicio"><input type="datetime-local" required value={local(f.starts_at)} onChange={(e) => setF({ ...f, starts_at: new Date(e.target.value).toISOString() })} /></Field>
          <Field label="Fin"><input type="datetime-local" value={local(f.ends_at)} onChange={(e) => setF({ ...f, ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>
          <Field label="Lugar a visitar"><input value={f.place || ''} onChange={(e) => setF({ ...f, place: e.target.value })} /></Field>
          <Field label="Encargado"><input value={f.responsible || ''} onChange={(e) => setF({ ...f, responsible: e.target.value })} /></Field>
          <Field label="Costo (COP)"><input type="number" min="0" value={f.cost ?? ''} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
          <Field label="Detalles" className="full"><textarea value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Requisitos (uniforme, permiso firmado, refrigerio…)" className="full"><textarea value={f.requirements || ''} onChange={(e) => setF({ ...f, requirements: e.target.value })} /></Field>
          <div className="full row" style={{ justifyContent: 'flex-end' }}>
            {f.id && <GlowButton type="button" variant="bad" onClick={del}>Eliminar</GlowButton>}
            <GlowButton variant="solid" type="submit">Guardar</GlowButton>
          </div>
        </form>
      )}
    </Modal>
  );
}

function TeacherEvents({ myGroupIds }) {
  const { groups } = useData();
  const { profile } = useAuth();
  const [ev, setEv] = useState(null);
  const [k, setK] = useState(0);
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}><span className="spacer" /><GlowButton variant="solid" onClick={() => setEv({ kind: 'salida', group_id: myGroupIds[0] || '', starts_at: new Date().toISOString() })}>＋ Agendar actividad</GlowButton></div>
      <EventsList groupIds={myGroupIds} editable onEdit={(e) => e.created_by === profile.id && setEv(e)} reloadKey={k} />
      <EventForm event={ev} groups={groups.filter((g) => myGroupIds.includes(g.id))} onClose={() => setEv(null)} onSaved={() => { setEv(null); setK(k + 1); }} />
    </>
  );
}
