import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import Shell from '../components/Shell.jsx';
import Chat from '../components/Chat.jsx';
import { StudentExams } from './Exams.jsx';
import { AnnouncementsFeed } from '../components/Announcements.jsx';
import VirtualClass from '../components/VirtualClass.jsx';
import { ScheduleGrid, EventsList, DocumentsList } from '../components/Common.jsx';
import { useAuth, useData, scaleOf } from '../context.jsx';
import { supabase, q, rpc, openFile } from '../lib/supabase.js';
import { weightedAverage, levelFor, fmt, PERIODS, DAYS, normalize } from '../lib/grading.js';
import { fmtDate, fmtDateTime, fmtTime, todayISO, weekStart, addDays, toISO, currentBlock, nextBlock, isoDay } from '../lib/dates.js';
import { makePdf } from '../lib/pdf.js';
import { EPS } from '../lib/eps.js';
import {
  Card, Tabs, GlowButton, Empty, Spinner, Field, Modal, Stagger, StaggerItem, Progress, GradeBadge, Kpi, Bars, useToast, Avatar,
} from '../components/ui.jsx';

const PARENT_NAV = [
  { key: 'resumen', label: 'Resumen', icon: '🏠' },
  { key: 'avisos', label: 'Avisos', icon: '📢' },
  { key: 'notas', label: 'Notas', icon: '📊' },
  { key: 'examenes', label: 'Exámenes', icon: '📝' },
  { key: 'boletines', label: 'Boletines', icon: '📑' },
  { key: 'cronograma', label: 'Cronograma', icon: '🗓️' },
  { key: 'ubicacion', label: 'Ubicación', icon: '📍' },
  { key: 'asistencia', label: 'Asistencia', icon: '✅' },
  { key: 'horario', label: 'Horario', icon: '⏰' },
  { key: 'agenda', label: 'Actividades', icon: '🚌' },
  { key: 'salidas', label: 'Salidas', icon: '🚪' },
  { key: 'documentos', label: 'Documentos', icon: '📘' },
  { key: 'chat', label: 'Chat', icon: '💬' },
  { key: 'perfil', label: 'Estudiante', icon: '🧒' },
];
const STUDENT_NAV = [
  { key: 'notas', label: 'Mis notas', icon: '📊' },
  { key: 'examenes', label: 'Exámenes', icon: '📝' },
  { key: 'avisos', label: 'Avisos', icon: '📢' },
  { key: 'clases', label: 'Clase virtual', icon: '🎥' },
  { key: 'cronograma', label: 'Agenda', icon: '🗓️' },
  { key: 'horario', label: 'Horario', icon: '⏰' },
  { key: 'agenda', label: 'Actividades', icon: '🚌' },
  { key: 'chat', label: 'Chat', icon: '💬' },
];

export default function Family() {
  const { profile } = useAuth();
  const isStudent = profile.role === 'student';
  const nav = isStudent ? STUDENT_NAV : PARENT_NAV;
  const [tab, setTab] = useState(nav[0].key);
  const [children, setChildren] = useState(null);
  const [childId, setChildId] = useState(null);

  useEffect(() => {
    const qq = supabase.from('students').select('*, profile:profiles!students_id_fkey(full_name, username, doc_id)');
    q(isStudent ? qq.eq('id', profile.id) : qq.eq('parent_id', profile.id)).then((c) => { setChildren(c); setChildId(c[0]?.id || null); }).catch(() => setChildren([]));
  }, [profile.id, isStudent]);

  const child = children?.find((c) => c.id === childId);
  const data = useChildData(child);
  const title = nav.find((n) => n.key === tab)?.label;

  const picker = !isStudent && children?.length > 1 && (
    <select value={childId || ''} onChange={(e) => setChildId(e.target.value)} style={{ width: 'auto' }}>
      {children.map((c) => <option key={c.id} value={c.id}>{c.profile?.full_name}</option>)}
    </select>
  );

  return (
    <Shell nav={nav} active={tab} onNav={setTab} title={title}
      subtitle={child ? `${child.profile?.full_name} · ${data.group?.name || 'Sin grupo'}` : undefined} actions={picker}>
      {!children ? <Spinner /> : !child ? <Empty icon="🧒">No hay estudiantes vinculados a esta cuenta. Comuníquese con el colegio.</Empty>
        : data.loading ? <Spinner /> : (
          <>
            {tab === 'resumen' && <Summary child={child} d={data} go={setTab} />}
            {tab === 'notas' && <GradesBySubject d={data} />}
            {tab === 'examenes' && <Exams d={data} child={child} canTake={isStudent} />}
            {tab === 'avisos' && <AnnouncementsFeed />}
            {tab === 'boletines' && <Bulletins child={child} d={data} />}
            {tab === 'cronograma' && <WeeklyPlan d={data} />}
            {tab === 'ubicacion' && <Location d={data} child={child} />}
            {tab === 'asistencia' && <AttendanceView d={data} />}
            {tab === 'horario' && <Card><ScheduleGrid blocks={data.schedule} /></Card>}
            {tab === 'agenda' && <EventsList groupIds={child.group_id ? [child.group_id] : []} />}
            {tab === 'salidas' && <Exits child={child} />}
            {tab === 'documentos' && <DocumentsList />}
            {tab === 'chat' && <Chat />}
            {tab === 'perfil' && <StudentProfile child={child} onSaved={(c) => setChildren((x) => x.map((i) => (i.id === c.id ? { ...i, ...c } : i)))} />}
            {tab === 'clases' && <StudentClass d={data} />}
          </>
        )}
    </Shell>
  );
}

// ---------- datos del estudiante ----------
function useChildData(child) {
  const { subjects, schedule, groupById, grading } = useData();
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    if (!child) return;
    let alive = true;
    const subs = subjects.filter((s) => s.group_id === child.group_id);
    const ids = subs.map((s) => s.id);
    const none = ['00000000-0000-0000-0000-000000000000'];
    setSt({ loading: true });
    Promise.all([
      q(supabase.from('tasks').select('*').in('subject_id', ids.length ? ids : none).order('due_date')),
      q(supabase.from('grades').select('*').eq('student_id', child.id)),
      q(supabase.from('attendance').select('*').eq('student_id', child.id).order('date', { ascending: false })),
      q(supabase.from('topics').select('*').in('subject_id', ids.length ? ids : none).order('week_start')),
    ]).then(([tasks, grades, attendance, topics]) => {
      if (!alive) return;
      const gradeByTask = Object.fromEntries(grades.map((g) => [g.task_id, g]));
      setSt({ loading: false, tasks, grades, gradeByTask, attendance, topics });
    }).catch(() => alive && setSt({ loading: false, tasks: [], grades: [], gradeByTask: {}, attendance: [], topics: [] }));
    return () => { alive = false; };
  }, [child?.id, child?.group_id, subjects]); // eslint-disable-line

  return useMemo(() => {
    if (!child || st.loading) return { loading: true };
    const subs = subjects.filter((s) => s.group_id === child.group_id);
    const sched = schedule.filter((b) => b.group_id === child.group_id);
    const avg = (subjectId, period) => weightedAverage(
      st.tasks.filter((t) => t.subject_id === subjectId && (!period || t.period === period))
        .map((t) => ({ value: st.gradeByTask[t.id]?.value, weight: t.weight })));
    return { ...st, subjects: subs, schedule: sched, group: groupById[child.group_id], avg, scale: (s) => scaleOf(s, grading) };
  }, [child, st, subjects, schedule, groupById, grading]);
}

// ---------- Resumen / consolidado ----------
function Summary({ child, d, go }) {
  const { roomById, staffById, subjectById } = useData();
  const absences = d.attendance.filter((a) => a.status === 'ausente').length;
  const pct = d.attendance.length ? (100 * d.attendance.filter((a) => a.status !== 'ausente').length) / d.attendance.length : null;
  const now = currentBlock(d.schedule);
  const avgs = d.subjects.map((s) => ({ s, v: d.avg(s.id) }));
  const general = avgs.filter((a) => a.v != null);
  const genNorm = general.length ? general.reduce((a, x) => a + normalize(x.v, d.scale(x.s)), 0) / general.length : null;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g4">
        <Kpi icon="📈" label="Promedio general (%)" value={genNorm == null ? null : genNorm * 100} decimals={0} suffix="%" />
        <Kpi icon="✅" label="Asistencia" value={pct} decimals={0} suffix="%" delay={0.05} />
        <Kpi icon="🚨" label="Inasistencias" value={absences} delay={0.1} />
        <Kpi icon="📚" label="Asignaturas" value={d.subjects.length} delay={0.15} />
      </div>
      <AnnouncementsFeed limit={2} />
      <Card glow title="📍 ¿Dónde está ahora?" actions={<GlowButton size="sm" onClick={() => go('ubicacion')}>Ver detalle</GlowButton>}>
        {now ? (
          <div className="row"><span style={{ fontSize: 34 }}>🏫</span>
            <div><h2>{roomById[now.room_id]?.name || 'Salón sin asignar'}</h2>
              <p className="muted">{subjectById[now.subject_id]?.name} con {staffById[subjectById[now.subject_id]?.teacher_id]?.full_name || '—'} · {fmtTime(now.start_time)}–{fmtTime(now.end_time)}</p></div></div>
        ) : <p className="muted">{child.profile?.full_name} no tiene clase en este momento según el horario.</p>}
      </Card>
      <Card title="Consolidado de notas por asignatura">
        <div className="table-wrap"><table>
          <thead><tr><th>Asignatura</th>{PERIODS.map((p) => <th key={p}>P{p}</th>)}<th>Acumulado</th></tr></thead>
          <tbody>{d.subjects.map((s) => (
            <tr key={s.id}><td><span style={{ color: s.color }}>●</span> {s.name}</td>
              {PERIODS.map((p) => <td key={p}>{fmt(d.avg(s.id, p), d.scale(s))}</td>)}
              <td><GradeBadge value={d.avg(s.id)} scale={d.scale(s)} /></td></tr>
          ))}</tbody>
        </table></div>
        <div style={{ marginTop: 16 }}>
          <Bars data={avgs.map(({ s, v }) => ({ label: s.name.slice(0, 10), value: v == null ? null : Math.round(normalize(v, d.scale(s)) * 100), color: levelFor(v, d.scale(s))?.color }))} max={100} format={(v) => v + '%'} />
        </div>
      </Card>
    </div>
  );
}

// ---------- Notas por asignatura y tarea ----------
function GradesBySubject({ d }) {
  const toast = useToast();
  const { staffById } = useData();
  const [open, setOpen] = useState(d.subjects[0]?.id);
  const [period, setPeriod] = useState(0);
  if (!d.subjects.length) return <Empty icon="📚">Aún no hay asignaturas para este grupo</Empty>;
  return (
    <div className="col">
      <Tabs tabs={[{ key: 0, label: 'Todos los periodos' }, ...PERIODS.map((p) => ({ key: p, label: `Periodo ${p}` }))]} value={period} onChange={setPeriod} />
      {d.subjects.map((s, i) => {
        const tasks = d.tasks.filter((t) => t.subject_id === s.id && (!period || t.period === period));
        const isOpen = open === s.id;
        return (
          <Card key={s.id} delay={i * 0.04}>
            <div className="row" style={{ cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : s.id)}>
              <span style={{ width: 12, height: 12, borderRadius: 4, background: s.color, boxShadow: `0 0 10px ${s.color}` }} />
              <div style={{ flex: 1 }}><h3>{s.name}</h3><span className="small muted">{staffById[s.teacher_id]?.full_name || 'Sin docente'} · {tasks.length} actividades</span></div>
              <GradeBadge value={d.avg(s.id, period || undefined)} scale={d.scale(s)} />
              <motion.span animate={{ rotate: isOpen ? 180 : 0 }}>⌄</motion.span>
            </div>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                  <div className="table-wrap" style={{ marginTop: 14 }}><table>
                    <thead><tr><th>Actividad</th><th>Tipo</th><th>Periodo</th><th>Entrega</th><th>Peso</th><th>Nota</th><th>Observación</th><th>Material</th></tr></thead>
                    <tbody>
                      {tasks.length === 0 && <tr><td colSpan={8} className="muted">Sin actividades</td></tr>}
                      {tasks.map((t) => {
                        const g = d.gradeByTask[t.id];
                        return (
                          <tr key={t.id}><td><strong>{t.title}</strong>{t.description && <div className="small muted" style={{ whiteSpace: 'normal', maxWidth: 260 }}>{t.description}</div>}</td>
                            <td><span className="badge">{t.kind}</span></td><td>P{t.period}</td><td>{fmtDate(t.due_date)}</td><td>{t.weight}</td>
                            <td><GradeBadge value={g?.value} scale={d.scale(s)} /></td><td className="small">{g?.comment || ''}</td>
                            <td>{(t.files || []).map((f) => <a key={f.path} href="#" className="small" style={{ display: 'block' }} onClick={(e) => { e.preventDefault(); openFile('colegio-tareas', f.path, f.name).catch(toast); }}>📎 {f.name}</a>)}</td></tr>
                        );
                      })}
                    </tbody>
                  </table></div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        );
      })}
    </div>
  );
}

function Exams({ d, child, canTake }) {
  const { subjectById } = useData();
  const exams = d.tasks.filter((t) => t.kind === 'examen');
  const today = todayISO();
  const upcoming = exams.filter((t) => !t.due_date || t.due_date >= today);
  const past = exams.filter((t) => t.due_date && t.due_date < today).reverse();
  const row = (t) => {
    const s = subjectById[t.subject_id]; const g = d.gradeByTask[t.id];
    return (
      <StaggerItem key={t.id} className="list-item">
        <span style={{ fontSize: 24 }}>📝</span>
        <div style={{ flex: 1 }}><strong>{t.title}</strong><div className="small muted">{s?.name} · {fmtDate(t.due_date)} · Periodo {t.period}</div>{t.description && <p className="small">{t.description}</p>}</div>
        <GradeBadge value={g?.value} scale={d.scale(s)} />
      </StaggerItem>
    );
  };
  return (
    <div className="col" style={{ gap: 18 }}>
      <Card glow title="📝 Exámenes en línea"><StudentExams studentId={child.id} canTake={canTake} /></Card>
      <div className="grid g2">
      <Card title="Próximos exámenes">{upcoming.length ? <Stagger>{upcoming.map(row)}</Stagger> : <Empty icon="🎉">No hay exámenes programados</Empty>}</Card>
      <Card title="Exámenes presentados">{past.length ? <Stagger>{past.map(row)}</Stagger> : <Empty icon="📝">Aún no hay resultados</Empty>}</Card>
      </div>
    </div>
  );
}

// ---------- Boletines por periodo ----------
function Bulletins({ child, d }) {
  const { school, staffById } = useData();
  const [period, setPeriod] = useState(1);
  const rows = d.subjects.map((s) => {
    const v = d.avg(s.id, period);
    const abs = d.attendance.filter((a) => a.subject_id === s.id && a.status === 'ausente').length;
    return { s, v, l: levelFor(v, d.scale(s)), abs };
  });
  const download = () => makePdf({
    school: school.name, title: `Boletín de calificaciones · Periodo ${period}`,
    subtitle: `Estudiante: ${child.profile?.full_name}   Documento: ${child.doc_id}   Grupo: ${d.group?.name || ''}   Director(a) de grupo: ${staffById[d.group?.director_id]?.full_name || '—'}`,
    head: ['Asignatura', 'Docente', 'Nota', 'Desempeño', 'Escala', 'Inasistencias'],
    body: rows.map((r) => [r.s.name, staffById[r.s.teacher_id]?.full_name || '', fmt(r.v, d.scale(r.s)), r.l?.name || 'Sin nota', d.scale(r.s), r.abs]),
    footer: 'Escala de valoración institucional equivalente a la escala nacional (Decreto 1290 de 2009): Desempeño Superior, Alto, Básico y Bajo.',
    filename: `boletin-P${period}-${child.doc_id}.pdf`,
  });
  return (
    <Card glow title="Boletín" actions={<GlowButton variant="ok" onClick={download}>⬇ Descargar PDF</GlowButton>}>
      <Tabs tabs={PERIODS.map((p) => ({ key: p, label: `Periodo ${p}` }))} value={period} onChange={setPeriod} />
      <Stagger className="grid g3">
        {rows.map((r) => (
          <StaggerItem key={r.s.id}>
            <motion.div className="card" whileHover={{ scale: 1.03 }} style={{ borderColor: r.l ? r.l.color + '77' : undefined }}>
              <div className="small muted">{r.s.name}</div>
              <div className="row"><span style={{ fontSize: '2rem', fontWeight: 800, color: r.l?.color }}>{fmt(r.v, d.scale(r.s))}</span><span className="spacer" />{r.l && <span className="badge" style={{ color: r.l.color }}>{r.l.name}</span>}</div>
              <Progress value={r.v == null ? 0 : normalize(r.v, d.scale(r.s)) * 100} />
              <div className="small muted" style={{ marginTop: 6 }}>Inasistencias: {r.abs}</div>
            </motion.div>
          </StaggerItem>
        ))}
      </Stagger>
    </Card>
  );
}

// ---------- Cronograma semanal ----------
function WeeklyPlan({ d }) {
  const { staffById } = useData();
  const [ws, setWs] = useState(weekStart());
  const key = toISO(ws);
  const list = d.topics.filter((t) => t.week_start === key);
  return (
    <Card title={`Semana del ${fmtDate(key)} al ${fmtDate(toISO(addDays(ws, 4)))}`} actions={
      <div className="row"><GlowButton size="sm" onClick={() => setWs(addDays(ws, -7))}>←</GlowButton><GlowButton size="sm" variant="ghost" onClick={() => setWs(weekStart())}>Hoy</GlowButton><GlowButton size="sm" onClick={() => setWs(addDays(ws, 7))}>→</GlowButton></div>}>
      <AnimatePresence mode="wait">
        <motion.div key={key} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
          {d.subjects.every((s) => !list.some((t) => t.subject_id === s.id)) ? <Empty icon="🗓️">No hay actividades programadas esta semana</Empty> : (
            <div className="grid g2">
              {d.subjects.map((s) => {
                const items = list.filter((t) => t.subject_id === s.id);
                if (!items.length) return null;
                return (
                  <div key={s.id} className="card" style={{ borderLeft: `4px solid ${s.color}` }}>
                    <strong>{s.name}</strong><div className="small muted">{staffById[s.teacher_id]?.full_name}</div>
                    <div className="col" style={{ marginTop: 10, gap: 8 }}>
                      {items.map((t) => (
                        <div key={t.id} className="row" style={{ alignItems: 'flex-start' }}>
                          <span>{t.done ? '✅' : '⏳'}</span>
                          <div><strong className="small">{t.title}</strong>{t.description && <p className="small muted">{t.description}</p>}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      {d.tasks.filter((t) => t.due_date >= key && t.due_date <= toISO(addDays(ws, 6))).length > 0 && (
        <div style={{ marginTop: 16 }}><h3 style={{ marginBottom: 8 }}>Entregas de la semana</h3>
          {d.tasks.filter((t) => t.due_date >= key && t.due_date <= toISO(addDays(ws, 6))).map((t) => (
            <div key={t.id} className="small">📌 {fmtDate(t.due_date)} · <strong>{t.title}</strong> ({d.subjects.find((s) => s.id === t.subject_id)?.name})</div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------- Ubicación actual ----------
function Location({ d, child }) {
  const { roomById, staffById, subjectById } = useData();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  const now = currentBlock(d.schedule);
  const next = nextBlock(d.schedule);
  const todayBlocks = d.schedule.filter((b) => b.day === isoDay());
  const todayAtt = Object.fromEntries(d.attendance.filter((a) => a.date === todayISO()).map((a) => [a.subject_id, a]));
  const sb = now && subjectById[now.subject_id];
  return (
    <div className="grid g2">
      <Card glow>
        <div className="col" style={{ alignItems: 'center', textAlign: 'center', padding: 20 }}>
          <motion.div animate={{ scale: [1, 1.12, 1] }} transition={{ repeat: Infinity, duration: 2 }} style={{ fontSize: 64, filter: 'drop-shadow(0 0 18px #00e5ff)' }}>📍</motion.div>
          {now ? (
            <>
              <span className="muted">En este momento {child.profile?.full_name} está en</span>
              <h1 className="grad-text" style={{ fontSize: '2.4rem' }}>{roomById[now.room_id]?.name || 'Salón sin asignar'}</h1>
              <h3>{sb?.name}</h3>
              <div className="row" style={{ justifyContent: 'center' }}><Avatar name={staffById[sb?.teacher_id]?.full_name || '?'} size={34} /><span>Docente: <strong>{staffById[sb?.teacher_id]?.full_name || '—'}</strong></span></div>
              <span className="badge info">{fmtTime(now.start_time)} – {fmtTime(now.end_time)}</span>
              {todayAtt[now.subject_id] && <span className={`badge ${todayAtt[now.subject_id].status === 'ausente' ? 'bad' : 'ok'}`}>Asistencia: {todayAtt[now.subject_id].status}</span>}
            </>
          ) : (
            <>
              <h2>Fuera del horario de clases</h2>
              {next ? <p className="muted">Próxima clase: {subjectById[next.subject_id]?.name} a las {fmtTime(next.start_time)} en {roomById[next.room_id]?.name}</p> : <p className="muted">No hay más clases programadas hoy</p>}
            </>
          )}
        </div>
      </Card>
      <Card title={`Recorrido de hoy · ${DAYS[isoDay()] || ''}`}>
        {todayBlocks.length === 0 ? <Empty icon="🛋️">Sin clases hoy</Empty> : (
          <Stagger>{todayBlocks.map((b) => {
            const s = subjectById[b.subject_id]; const isNow = now?.id === b.id; const a = todayAtt[b.subject_id];
            return (
              <StaggerItem key={b.id} className="list-item" style={isNow ? { borderColor: 'var(--b)', boxShadow: '0 0 16px rgba(0,229,255,.4)' } : undefined}>
                <span className="badge">{fmtTime(b.start_time)}</span>
                <div style={{ flex: 1 }}><strong>{s?.name}</strong><div className="small muted">{roomById[b.room_id]?.name} · {staffById[s?.teacher_id]?.full_name}</div></div>
                {a && <span className={`badge ${a.status === 'ausente' ? 'bad' : a.status === 'presente' ? 'ok' : 'warn'}`}>{a.status}</span>}
              </StaggerItem>
            );
          })}</Stagger>
        )}
      </Card>
    </div>
  );
}

// ---------- Asistencia ----------
function AttendanceView({ d }) {
  const { subjectById } = useData();
  const [filter, setFilter] = useState('todos');
  const counts = ['presente', 'ausente', 'tarde', 'excusa'].map((s) => ({ s, n: d.attendance.filter((a) => a.status === s).length }));
  const list = d.attendance.filter((a) => filter === 'todos' || a.status === filter);
  const color = { presente: 'ok', ausente: 'bad', tarde: 'warn', excusa: 'info' };
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid g4">{counts.map((c, i) => <Kpi key={c.s} icon={{ presente: '✅', ausente: '🚨', tarde: '⏰', excusa: '📄' }[c.s]} label={c.s[0].toUpperCase() + c.s.slice(1)} value={c.n} delay={i * 0.05} />)}</div>
      <Card title="Registro de asistencia">
        <Tabs tabs={['todos', 'presente', 'ausente', 'tarde', 'excusa'].map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1) }))} value={filter} onChange={setFilter} />
        {list.length === 0 ? <Empty icon="✅">Sin registros</Empty> : (
          <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Asignatura</th><th>Estado</th><th>Observación</th></tr></thead>
            <tbody>{list.map((a) => <tr key={a.id}><td>{fmtDate(a.date)}</td><td>{subjectById[a.subject_id]?.name}</td><td><span className={`badge ${color[a.status]}`}>{a.status}</span></td><td className="small">{a.note}</td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

// ---------- Solicitud de salida (con ubicación) ----------
function Exits({ child }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [list, setList] = useState(null);
  const [f, setF] = useState({ reason: '', pickup_person: '', valid_date: todayISO() });
  const [busy, setBusy] = useState(false);
  const load = () => q(supabase.from('exit_permissions').select('*').eq('student_id', child.id).order('created_at', { ascending: false }).limit(30)).then(setList);
  useEffect(() => { load(); }, [child.id]); // eslint-disable-line

  const getPos = () => new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition((p) => res(p.coords), () => res(null), { enableHighAccuracy: true, timeout: 10000 });
  });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const c = await getPos();
      if (!c) toast('No se pudo obtener la ubicación; la solicitud se registrará sin coordenadas', 'info');
      await q(supabase.from('exit_permissions').insert({ student_id: child.id, requested_by: profile.id, requester_role: 'parent', ...f, lat: c?.latitude, lng: c?.longitude, accuracy: c?.accuracy }));
      toast('Autorización de salida registrada. Portería ya puede verificarla.');
      setF({ reason: '', pickup_person: '', valid_date: todayISO() }); load();
    } catch (err) { toast(err); } finally { setBusy(false); }
  };
  const revoke = async (id) => { await supabase.from('exit_permissions').update({ status: 'revocada' }).eq('id', id); load(); };

  return (
    <div className="grid g2">
      <Card glow title="Autorizar salida durante la jornada">
        <form className="col" onSubmit={submit}>
          <Field label="Fecha"><input type="date" min={todayISO()} value={f.valid_date} onChange={(e) => setF({ ...f, valid_date: e.target.value })} required /></Field>
          <Field label="Motivo"><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required placeholder="Cita médica, calamidad…" /></Field>
          <Field label="Persona que recoge (nombre y documento)"><input value={f.pickup_person} onChange={(e) => setF({ ...f, pickup_person: e.target.value })} required /></Field>
          <p className="small muted">📍 Al enviar se registrará la ubicación desde donde realiza la solicitud.</p>
          <GlowButton variant="solid" type="submit" disabled={busy}>{busy ? 'Registrando…' : 'Autorizar salida'}</GlowButton>
        </form>
        <div className="col" style={{ alignItems: 'center', marginTop: 20 }}>
          <span className="small muted">Carné QR del estudiante (lo escanea portería)</span>
          <motion.div whileHover={{ scale: 1.05 }} style={{ background: '#fff', padding: 12, borderRadius: 14, boxShadow: '0 0 24px rgba(0,229,255,.4)' }}>
            <QRCodeSVG value={child.doc_id} size={150} />
          </motion.div>
          <span className="small">Documento: {child.doc_id}</span>
        </div>
      </Card>
      <Card title="Historial de salidas">
        {!list ? <Spinner /> : list.length === 0 ? <Empty icon="🚪">Sin solicitudes</Empty> : (
          <Stagger>{list.map((e) => (
            <StaggerItem key={e.id} className="list-item">
              <span style={{ fontSize: 22 }}>{e.status === 'usada' ? '✅' : e.status === 'revocada' ? '⛔' : '🟢'}</span>
              <div style={{ flex: 1 }}>
                <strong>{fmtDate(e.valid_date)}</strong> · {e.reason}
                <div className="small muted">Recoge: {e.pickup_person} · Solicitado {fmtDateTime(e.created_at)}</div>
                {e.lat && <a className="small" href={`https://www.google.com/maps?q=${e.lat},${e.lng}`} target="_blank" rel="noreferrer">📍 Ubicación de la solicitud</a>}
                {e.used_at && <div className="small" style={{ color: 'var(--ok)' }}>Salió a las {new Date(e.used_at).toLocaleTimeString('es-CO')}</div>}
              </div>
              {e.status === 'autorizada' && e.requested_by === profile.id && <GlowButton size="sm" variant="bad" onClick={() => revoke(e.id)}>Revocar</GlowButton>}
            </StaggerItem>
          ))}</Stagger>
        )}
      </Card>
    </div>
  );
}

// ---------- Perfil del estudiante: salud, segundo responsable, contraseña ----------

function StudentProfile({ child, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ eps: child.eps || '', clinic: child.clinic || '', blood: child.blood_type || '', g2: child.guardian2 || {} });
  const [pw, setPw] = useState({ a: '', b: '' });
  const setG = (k, v) => setF({ ...f, g2: { ...f.g2, [k]: v } });
  const save = async (e) => {
    e.preventDefault();
    try {
      await rpc('cg_parent_update_student', { st: child.id, p_eps: f.eps, p_clinic: f.clinic, p_blood: f.blood, p_guardian2: f.g2 });
      onSaved({ id: child.id, eps: f.eps, clinic: f.clinic, blood_type: f.blood, guardian2: f.g2 });
      toast('Información guardada');
    } catch (err) { toast(err); }
  };
  const savePw = async (e) => {
    e.preventDefault();
    if (pw.a !== pw.b) return toast(new Error('Las contraseñas no coinciden'));
    try { await rpc('cg_parent_set_student_password', { st: child.id, pw: pw.a }); setPw({ a: '', b: '' }); toast('Contraseña del estudiante actualizada'); } catch (err) { toast(err); }
  };
  return (
    <div className="grid g2">
      <Card glow title="Salud y contactos de emergencia">
        <form className="col" onSubmit={save}>
          <fieldset><legend>🏥 Salud</legend>
            <Field label="EPS o seguro médico"><input list="eps-list" value={f.eps} onChange={(e) => setF({ ...f, eps: e.target.value })} /><datalist id="eps-list">{EPS.map((x) => <option key={x} value={x} />)}</datalist></Field>
            <Field label="Clínica o centro médico de traslado (opcional)"><input value={f.clinic} onChange={(e) => setF({ ...f, clinic: e.target.value })} placeholder="Ej. Clínica del Country" /></Field>
            <Field label="Grupo sanguíneo"><select value={f.blood} onChange={(e) => setF({ ...f, blood: e.target.value })}><option value="">—</option>{['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          </fieldset>
          <fieldset><legend>👥 Segundo responsable</legend>
            <Field label="Nombre completo"><input value={f.g2.name || ''} onChange={(e) => setG('name', e.target.value)} /></Field>
            <Field label="Parentesco"><input value={f.g2.relation || ''} onChange={(e) => setG('relation', e.target.value)} placeholder="Madre, tío, abuela…" /></Field>
            <Field label="Documento"><input value={f.g2.doc || ''} onChange={(e) => setG('doc', e.target.value)} /></Field>
            <Field label="Teléfono"><input type="tel" value={f.g2.phone || ''} onChange={(e) => setG('phone', e.target.value)} /></Field>
            <Field label="Correo"><input type="email" value={f.g2.email || ''} onChange={(e) => setG('email', e.target.value)} /></Field>
            <Field label="Dirección"><input value={f.g2.address || ''} onChange={(e) => setG('address', e.target.value)} /></Field>
          </fieldset>
          <GlowButton variant="solid" type="submit">Guardar</GlowButton>
        </form>
      </Card>
      <div className="col">
        <Card title="Datos del estudiante">
          <div className="row"><Avatar name={child.profile?.full_name} size={56} /><div><h3>{child.profile?.full_name}</h3><div className="small muted">Usuario: {child.profile?.username} · Doc: {child.doc_id}</div></div></div>
        </Card>
        <Card title="🔑 Contraseña del estudiante">
          <p className="small muted" style={{ marginBottom: 10 }}>Como acudiente, usted asigna y modifica la contraseña con la que su hijo(a) ingresa a la app.</p>
          <form className="col" onSubmit={savePw}>
            <Field label="Nueva contraseña"><input type="password" minLength={4} required value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} autoComplete="new-password" /></Field>
            <Field label="Repetir contraseña"><input type="password" minLength={4} required value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} autoComplete="new-password" /></Field>
            <GlowButton variant="warn" type="submit">Actualizar contraseña</GlowButton>
          </form>
        </Card>
      </div>
    </div>
  );
}

// ---------- Clase virtual (estudiante) ----------
function StudentClass({ d }) {
  const toast = useToast();
  const [active, setActive] = useState([]);
  const [code, setCode] = useState('');
  const [session, setSession] = useState(null);
  useEffect(() => {
    const load = () => rpc('cg_my_active_classes').then(setActive).catch(() => {});
    load(); const t = setInterval(load, 15000); return () => clearInterval(t);
  }, []);
  const join = async (e) => {
    e.preventDefault();
    try { const [s] = await rpc('cg_join_class', { p_code: code }); setSession(s); } catch (err) { toast(err); }
  };
  if (session) return <VirtualClass role="student" session={session} onExit={() => { setSession(null); setCode(''); }} />;
  return (
    <div className="grid g2">
      <Card glow title="Unirse a la clase">
        <form className="col" onSubmit={join} style={{ alignItems: 'center', textAlign: 'center' }}>
          <motion.div animate={{ rotate: [0, 6, -6, 0] }} transition={{ repeat: Infinity, duration: 3 }} style={{ fontSize: 56 }}>🎥</motion.div>
          <p className="muted">Ingresa el código de 4 dígitos que te dio tu docente</p>
          <input inputMode="numeric" pattern="\d{4}" maxLength={4} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            style={{ fontSize: '2.2rem', textAlign: 'center', letterSpacing: '.5em', maxWidth: 240 }} placeholder="0000" />
          <GlowButton variant="solid" size="lg" type="submit" disabled={code.length !== 4}>Entrar a clase</GlowButton>
          <p className="small muted">Solo puedes conectarte a clases de tu salón y con un solo dispositivo a la vez.</p>
        </form>
      </Card>
      <Card title="Clases en vivo de tu salón">
        {active.length === 0 ? <Empty icon="😴">No hay clases en vivo ahora</Empty> : active.map((c) => (
          <div key={c.id} className="list-item"><span className="badge bad">● EN VIVO</span><div><strong>{c.subject}</strong><div className="small muted">{c.teacher} · desde {new Date(c.started_at).toLocaleTimeString('es-CO')}</div></div></div>
        ))}
      </Card>
    </div>
  );
}
