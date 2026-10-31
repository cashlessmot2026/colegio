import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Notebook from '../components/Notebook.jsx';
import { useData } from '../context.jsx';
import { supabase, q, rpc } from '../lib/supabase.js';
import { PERIODS } from '../lib/grading.js';
import { fmtDateTime } from '../lib/dates.js';
import { Card, GlowButton, Empty, Spinner, Field, Modal, Stagger, StaggerItem, Progress, Tabs, useToast, Avatar, GradeBadge, AnimatedNumber } from '../components/ui.jsx';
import { scaleOf } from '../context.jsx';

const KIND_LABEL = { unica: 'Selección única', multiple: 'Selección múltiple', cuaderno: 'Desarrollo en cuaderno' };
const STATUS = {
  sin_iniciar: ['Sin iniciar', 'info'], en_curso: ['En curso', 'warn'], pendiente: ['Esperando validación del docente', 'warn'], calificado: ['Calificado', 'ok'],
};
const toLocal = (v) => (v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);
const letter = (i) => String.fromCharCode(65 + i);

// =====================================================================
//  DOCENTE
// =====================================================================
export function TeacherExams({ mySubjects, students }) {
  const { groupById, subjectById } = useData();
  const toast = useToast();
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const [review, setReview] = useState(null);
  const load = () => q(supabase.from('exams').select('*, attempts:exam_attempts(status)').in('subject_id', mySubjects.map((s) => s.id).concat('00000000-0000-0000-0000-000000000000')).order('created_at', { ascending: false }))
    .then(setList).catch((e) => { toast(e); setList([]); });
  useEffect(() => { load(); }, []); // eslint-disable-line

  if (edit) return <ExamEditor exam={edit} subjects={mySubjects} onClose={() => { setEdit(null); load(); }} />;
  if (review) return <ExamReview exam={review} students={students} onBack={() => { setReview(null); load(); }} />;
  if (!mySubjects.length) return <Empty icon="📝">No tiene asignaturas asignadas</Empty>;
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="muted">Cree exámenes con selección única, múltiple, desarrollo en cuaderno o selección con justificación.</span>
        <span className="spacer" />
        <GlowButton variant="solid" onClick={() => setEdit({ subject_id: mySubjects[0].id, period: 1, show_results: 'inmediato', allow_edit: true, published: false, questions: [] })}>＋ Nuevo examen</GlowButton>
      </div>
      {!list ? <Spinner /> : !list.length ? <Empty icon="📝">Aún no ha creado exámenes</Empty> : (
        <Stagger className="grid g2">
          {list.map((e) => {
            const s = subjectById[e.subject_id];
            const pend = e.attempts.filter((a) => a.status === 'pendiente').length;
            const done = e.attempts.filter((a) => a.status !== 'en_curso').length;
            return (
              <StaggerItem key={e.id}>
                <motion.div className="card" whileHover={{ y: -4 }} style={{ borderTop: `4px solid ${s?.color}` }}>
                  <div className="row"><h3 style={{ flex: 1 }}>{e.title}</h3>{e.published ? <span className="badge ok">Publicado</span> : <span className="badge">Borrador</span>}</div>
                  <p className="small muted">{s?.name} · {groupById[s?.group_id]?.name} · Periodo {e.period}</p>
                  <p className="small" style={{ margin: '6px 0' }}>
                    {e.opens_at ? `Abre ${fmtDateTime(e.opens_at)}` : 'Disponible al publicar'}{e.closes_at ? ` · Cierra ${fmtDateTime(e.closes_at)}` : ''}{e.duration_min ? ` · ⏱ ${e.duration_min} min` : ''}
                  </p>
                  <div className="row small">
                    <span className="badge info">{e.show_results === 'inmediato' ? 'Resultado inmediato' : 'Resultado tras revisión'}</span>
                    <span className="badge">{e.allow_edit ? 'Respuestas modificables' : 'Respuestas bloqueadas al confirmar'}</span>
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <span className="small">📥 {done} entregas</span>{pend > 0 && <span className="badge warn">✍️ {pend} por validar</span>}
                    <span className="spacer" />
                    <GlowButton size="sm" variant="ghost" onClick={async () => setEdit({ ...e, questions: await q(supabase.from('exam_questions').select('*').eq('exam_id', e.id).order('position')) })}>Editar</GlowButton>
                    <GlowButton size="sm" variant={pend ? 'warn' : ''} onClick={() => setReview(e)}>Revisar</GlowButton>
                  </div>
                </motion.div>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </>
  );
}

function ExamEditor({ exam, subjects, onClose }) {
  const { groupById } = useData();
  const toast = useToast();
  const [f, setF] = useState(exam);
  const [qs, setQs] = useState(exam.questions || []);
  const [linkGrade, setLinkGrade] = useState(!!exam.task_id || !exam.id);
  const [busy, setBusy] = useState(false);
  const total = qs.reduce((a, x) => a + (Number(x.points) || 0), 0);

  const addQ = (kind) => setQs([...qs, { _new: crypto.randomUUID(), kind, prompt: '', options: kind === 'cuaderno' ? [] : ['', ''], correct: [], justify: false, points: 1 }]);
  const upd = (i, patch) => setQs(qs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i, d) => { const n = [...qs]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setQs(n); };
  const toggleCorrect = (i, k) => {
    const x = qs[i];
    if (x.kind === 'unica') return upd(i, { correct: [k] });
    upd(i, { correct: x.correct.includes(k) ? x.correct.filter((c) => c !== k) : [...x.correct, k].sort() });
  };

  const save = async (publish) => {
    if (!f.title?.trim()) return toast(new Error('Escriba el título del examen'));
    if (!qs.length) return toast(new Error('Agregue al menos una pregunta'));
    for (const [i, x] of qs.entries()) {
      if (!x.prompt.trim()) return toast(new Error(`La pregunta ${i + 1} no tiene enunciado`));
      if (x.kind !== 'cuaderno') {
        if (x.options.some((o) => !o.trim()) || x.options.length < 2) return toast(new Error(`Complete las opciones de la pregunta ${i + 1}`));
        if (!x.correct.length) return toast(new Error(`Marque la respuesta correcta de la pregunta ${i + 1}`));
      }
    }
    setBusy(true);
    try {
      let task_id = f.task_id || null;
      if (linkGrade && !task_id) {
        const t = await q(supabase.from('tasks').insert({ subject_id: f.subject_id, title: `Examen: ${f.title}`, kind: 'examen', period: Number(f.period), due_date: f.closes_at ? f.closes_at.slice(0, 10) : null, weight: 2, description: 'Examen en línea' }).select().single());
        task_id = t.id;
      }
      if (!linkGrade) task_id = null;
      const row = { subject_id: f.subject_id, title: f.title.trim(), instructions: f.instructions || null, period: Number(f.period), opens_at: f.opens_at || null, closes_at: f.closes_at || null,
        duration_min: f.duration_min ? Number(f.duration_min) : null, show_results: f.show_results, allow_edit: !!f.allow_edit, published: publish ?? f.published, task_id };
      const saved = f.id ? await q(supabase.from('exams').update(row).eq('id', f.id).select().single()) : await q(supabase.from('exams').insert(row).select().single());
      // sincroniza preguntas
      const keep = qs.filter((x) => x.id).map((x) => x.id);
      if (f.id) {
        let del = supabase.from('exam_questions').delete().eq('exam_id', saved.id);
        if (keep.length) del = del.not('id', 'in', `(${keep.join(',')})`);
        await q(del);
      }
      const rows = qs.map((x, i) => ({ ...(x.id ? { id: x.id } : {}), exam_id: saved.id, position: i, kind: x.kind, prompt: x.prompt.trim(), options: x.kind === 'cuaderno' ? [] : x.options.map((o) => o.trim()),
        correct: x.kind === 'cuaderno' ? [] : x.correct, justify: x.kind !== 'cuaderno' && !!x.justify, points: Number(x.points) || 1 }));
      const upd = rows.filter((r) => r.id), ins = rows.filter((r) => !r.id);
      if (upd.length) await q(supabase.from('exam_questions').upsert(upd));
      if (ins.length) await q(supabase.from('exam_questions').insert(ins));
      toast(publish ? 'Examen publicado: los estudiantes del grupo ya lo ven' : 'Examen guardado');
      onClose();
    } catch (e) { toast(e); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!window.confirm('¿Eliminar el examen y todas sus entregas?')) return;
    await supabase.from('exams').delete().eq('id', f.id); onClose();
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row">
        <GlowButton size="sm" variant="ghost" onClick={onClose}>← Volver</GlowButton>
        <h2 style={{ flex: 1 }}>{f.id ? 'Editar examen' : 'Nuevo examen'}</h2>
        <span className="badge">{qs.length} preguntas · {total} puntos</span>
      </div>
      <Card glow title="Configuración">
        <div className="form">
          <Field label="Título" className="full"><input value={f.title || ''} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Evaluación de fracciones" /></Field>
          <Field label="Asignatura"><select value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name} · {groupById[s.group_id]?.name}</option>)}</select></Field>
          <Field label="Periodo"><select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>{PERIODS.map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Abre (opcional)"><input type="datetime-local" value={toLocal(f.opens_at)} onChange={(e) => setF({ ...f, opens_at: fromLocal(e.target.value) })} /></Field>
          <Field label="Cierra (opcional)"><input type="datetime-local" value={toLocal(f.closes_at)} onChange={(e) => setF({ ...f, closes_at: fromLocal(e.target.value) })} /></Field>
          <Field label="Duración en minutos (vacío = sin límite)"><input type="number" min="1" value={f.duration_min || ''} onChange={(e) => setF({ ...f, duration_min: e.target.value })} /></Field>
          <Field label="¿Cuándo ve el estudiante el resultado?">
            <select value={f.show_results} onChange={(e) => setF({ ...f, show_results: e.target.value })}>
              <option value="inmediato">Inmediatamente al entregar</option><option value="revision">Cuando el docente lo califique</option>
            </select>
          </Field>
          <Field label="Instrucciones" className="full"><textarea value={f.instructions || ''} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>
          <label className="row small full"><input type="checkbox" checked={!!f.allow_edit} onChange={(e) => setF({ ...f, allow_edit: e.target.checked })} />
            Permitir que el estudiante modifique sus respuestas antes de entregar (si se desactiva, cada respuesta queda bloqueada al confirmarla)</label>
          <label className="row small full"><input type="checkbox" checked={linkGrade} onChange={(e) => setLinkGrade(e.target.checked)} /> Registrar la nota automáticamente en la planilla de notas (como actividad tipo examen)</label>
        </div>
      </Card>

      <AnimatePresence initial={false}>
        {qs.map((x, i) => (
          <motion.div key={x.id || x._new} layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -40 }}>
            <Card>
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="badge info">Pregunta {i + 1}</span><span className="badge">{KIND_LABEL[x.kind]}{x.justify ? ' + justificación' : ''}</span>
                <span className="spacer" />
                <label className="small row">Puntos <input type="number" min="0.5" step="0.5" value={x.points} onChange={(e) => upd(i, { points: e.target.value })} style={{ width: 70 }} /></label>
                <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="icon-btn" disabled={i === qs.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button className="icon-btn" onClick={() => setQs(qs.filter((_, j) => j !== i))}>🗑</button>
              </div>
              <textarea placeholder={x.kind === 'cuaderno' ? 'Ej. Resuelva la ecuación 3x + 5 = 20 y muestre el procedimiento' : 'Enunciado de la pregunta'} value={x.prompt} onChange={(e) => upd(i, { prompt: e.target.value })} />
              {x.kind !== 'cuaderno' && (
                <div className="col" style={{ marginTop: 10, gap: 8 }}>
                  <span className="small muted">Marque {x.kind === 'unica' ? 'la respuesta correcta' : 'todas las respuestas correctas'}:</span>
                  {x.options.map((o, k) => (
                    <div key={k} className="row" style={{ flexWrap: 'nowrap' }}>
                      <motion.button type="button" whileTap={{ scale: 0.85 }} className={`opt-mark ${x.correct.includes(k) ? 'on' : ''} ${x.kind === 'unica' ? 'round' : ''}`} onClick={() => toggleCorrect(i, k)}>{x.correct.includes(k) ? '✓' : letter(k)}</motion.button>
                      <input value={o} placeholder={`Opción ${letter(k)}`} onChange={(e) => upd(i, { options: x.options.map((y, j) => (j === k ? e.target.value : y)) })} />
                      <button className="icon-btn" disabled={x.options.length <= 2} onClick={() => upd(i, { options: x.options.filter((_, j) => j !== k), correct: x.correct.filter((c) => c !== k).map((c) => (c > k ? c - 1 : c)) })}>✕</button>
                    </div>
                  ))}
                  <div className="row">
                    {x.options.length < 8 && <GlowButton size="sm" variant="ghost" onClick={() => upd(i, { options: [...x.options, ''] })}>＋ Opción</GlowButton>}
                    <label className="row small"><input type="checkbox" checked={!!x.justify} onChange={(e) => upd(i, { justify: e.target.checked })} /> Pedir justificación en el cuaderno (la calificación de esta pregunta la valida el docente)</label>
                  </div>
                </div>
              )}
              {x.kind === 'cuaderno' && <p className="small muted" style={{ marginTop: 8 }}>📓 El estudiante tendrá un cuaderno con varias hojas para resolver y justificar. La valida el docente.</p>}
            </Card>
          </motion.div>
        ))}
      </AnimatePresence>

      <Card>
        <div className="row" style={{ justifyContent: 'center' }}>
          <GlowButton onClick={() => addQ('unica')}>◉ Selección única</GlowButton>
          <GlowButton onClick={() => addQ('multiple')}>☑ Selección múltiple</GlowButton>
          <GlowButton onClick={() => addQ('cuaderno')}>📓 Matemáticas / cuaderno</GlowButton>
        </div>
      </Card>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {f.id && <GlowButton variant="bad" onClick={del}>Eliminar</GlowButton>}
        {f.published && <GlowButton variant="warn" disabled={busy} onClick={() => save(false)}>Despublicar</GlowButton>}
        <GlowButton disabled={busy} onClick={() => save()}>💾 Guardar</GlowButton>
        {!f.published && <GlowButton variant="solid" size="lg" disabled={busy} onClick={() => save(true)}>🚀 Publicar</GlowButton>}
      </div>
    </div>
  );
}

function ExamReview({ exam, students, onBack }) {
  const toast = useToast();
  const { subjectById, grading } = useData();
  const [attempts, setAttempts] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [sel, setSel] = useState(null);
  const subject = subjectById[exam.subject_id];
  const groupStudents = students.filter((s) => s.group_id === subject?.group_id);
  const load = async () => {
    const [a, qs] = await Promise.all([
      q(supabase.from('exam_attempts').select('*').eq('exam_id', exam.id)),
      q(supabase.from('exam_questions').select('*').eq('exam_id', exam.id).order('position')),
    ]);
    setAttempts(a); setQuestions(qs);
  };
  useEffect(() => { load().catch(toast); }, []); // eslint-disable-line
  if (!attempts) return <Spinner />;
  const byStudent = Object.fromEntries(attempts.map((a) => [a.student_id, a]));
  const name = (id) => groupStudents.find((s) => s.id === id)?.profile.full_name || '—';

  if (sel) return <GradeAttempt attempt={sel} questions={questions} name={name(sel.student_id)} scale={scaleOf(subject, grading)} onBack={() => { setSel(null); load(); }} />;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row"><GlowButton size="sm" variant="ghost" onClick={onBack}>← Volver</GlowButton><h2 style={{ flex: 1 }}>{exam.title}</h2><span className="badge">{attempts.filter((a) => a.submitted_at).length}/{groupStudents.length} entregas</span></div>
      <Card>
        <div className="table-wrap"><table>
          <thead><tr><th>Estudiante</th><th>Estado</th><th>Entregado</th><th>Puntaje</th><th>Nota</th><th></th></tr></thead>
          <tbody>{groupStudents.map((s) => {
            const a = byStudent[s.id];
            const st = a ? STATUS[a.status] : STATUS.sin_iniciar;
            return (
              <tr key={s.id}>
                <td><div className="row" style={{ flexWrap: 'nowrap' }}><Avatar name={s.profile.full_name} size={28} />{s.profile.full_name}</div></td>
                <td><span className={`badge ${st[1]}`}>{st[0]}</span></td>
                <td className="small">{a?.submitted_at ? fmtDateTime(a.submitted_at) : '—'}</td>
                <td>{a?.submitted_at ? `${a.score ?? a.auto_score ?? 0} / ${a.max_score}` : '—'}</td>
                <td>{a?.grade != null ? <GradeBadge value={a.grade} scale={scaleOf(subject, grading)} /> : '—'}</td>
                <td><div className="row" style={{ flexWrap: 'nowrap' }}>
                  {a?.submitted_at && <GlowButton size="sm" variant={a.status === 'pendiente' ? 'warn' : 'ghost'} onClick={() => setSel(a)}>{a.status === 'pendiente' ? '✍️ Validar' : 'Ver'}</GlowButton>}
                  {a && <GlowButton size="sm" variant="bad" title="Permitir presentarlo de nuevo" onClick={async () => { if (window.confirm(`¿Reabrir el examen para ${s.profile.full_name}? Se borrarán sus respuestas.`)) { await rpc('cg_exam_reset_attempt', { p_attempt: a.id }).catch(toast); load(); } }}>↺</GlowButton>}
                </div></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </Card>
    </div>
  );
}

function GradeAttempt({ attempt, questions, name, scale, onBack }) {
  const toast = useToast();
  const det = attempt.details || {};
  const [manual, setManual] = useState(() => {
    const m = { ...attempt.manual };
    for (const x of questions) if (m[x.id] == null && det[x.id]?.points != null) m[x.id] = det[x.id].points;
    return m;
  });
  const [fb, setFb] = useState(attempt.feedback || '');
  const total = questions.reduce((a, x) => a + Math.min(Number(x.points), Number(manual[x.id] || 0)), 0);
  const save = async () => {
    try { await rpc('cg_exam_grade', { p_attempt: attempt.id, p_manual: manual, p_feedback: fb || null }); toast('Examen calificado y nota registrada'); onBack(); } catch (e) { toast(e); }
  };
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row"><GlowButton size="sm" variant="ghost" onClick={onBack}>← Volver</GlowButton><h2 style={{ flex: 1 }}>{name}</h2>
        <span className="badge info">Total: {total} / {attempt.max_score}</span></div>
      {questions.map((x, i) => {
        const ans = attempt.answers?.[x.id] || {};
        const d = det[x.id] || {};
        return (
          <Card key={x.id} delay={i * 0.03}>
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="badge info">P{i + 1}</span><span className="badge">{KIND_LABEL[x.kind]}{x.justify ? ' + justificación' : ''}</span>
              {d.pending && <span className="badge warn">Requiere validación</span>}
              {d.auto_ok === true && <span className="badge ok">Selección correcta</span>}
              {d.auto_ok === false && <span className="badge bad">Selección incorrecta</span>}
              <span className="spacer" />
              <label className="row small">Puntos <input type="number" min="0" max={x.points} step="0.5" value={manual[x.id] ?? ''} onChange={(e) => setManual({ ...manual, [x.id]: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 80 }} /> / {x.points}</label>
            </div>
            <p style={{ whiteSpace: 'pre-wrap', marginBottom: 10 }}>{x.prompt}</p>
            {x.kind !== 'cuaderno' && (
              <div className="col" style={{ gap: 6 }}>
                {x.options.map((o, k) => {
                  const chosen = (ans.choice || []).includes(k), right = x.correct.includes(k);
                  return <div key={k} className={`opt ${chosen ? 'chosen' : ''} ${right ? 'right' : chosen ? 'wrong' : ''}`}><b>{letter(k)}.</b> {o} {right && '✓'}{chosen && !right && ' ✕'}</div>;
                })}
              </div>
            )}
            {(x.kind === 'cuaderno' || x.justify) && (
              <div style={{ marginTop: 10 }}>{ans.pages?.some(Boolean) ? <Notebook value={ans.pages} readOnly height={460} /> : <p className="small muted">El estudiante no escribió en el cuaderno.</p>}</div>
            )}
          </Card>
        );
      })}
      <Card title="Retroalimentación para el estudiante">
        <textarea value={fb} onChange={(e) => setFb(e.target.value)} placeholder="Comentarios sobre el desempeño…" />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><GlowButton variant="solid" size="lg" onClick={save}>✓ Calificar ({total} / {attempt.max_score})</GlowButton></div>
      </Card>
    </div>
  );
}

// =====================================================================
//  ESTUDIANTE / PADRE
// =====================================================================
export function StudentExams({ studentId, canTake }) {
  const toast = useToast();
  const { subjectById } = useData();
  const [list, setList] = useState(null);
  const [taking, setTaking] = useState(null);
  const [result, setResult] = useState(null);
  const load = () => rpc('cg_my_exams', { p_student: studentId }).then(setList).catch((e) => { toast(e); setList([]); });
  useEffect(() => { load(); }, [studentId]); // eslint-disable-line

  if (taking) return <ExamTaker examId={taking} onDone={(r) => { setTaking(null); setResult({ id: r.examId, data: r.result }); load(); }} onExit={() => { setTaking(null); load(); }} />;
  if (result) return <ExamResult examId={result.id} studentId={studentId} initial={result.data} onBack={() => setResult(null)} />;
  if (!list) return <Spinner />;
  if (!list.length) return <Empty icon="📝">No hay exámenes en línea publicados</Empty>;
  const now = new Date().toISOString();
  return (
    <Stagger className="grid g2">
      {list.map((e) => {
        const s = subjectById[e.subject_id];
        const st = STATUS[e.status];
        const notYet = e.opens_at && e.opens_at > now;
        const closed = e.closes_at && e.closes_at < now;
        const submitted = !!e.submitted_at;
        return (
          <StaggerItem key={e.id}>
            <motion.div className="card" whileHover={{ y: -4 }} style={{ borderLeft: `4px solid ${s?.color}` }}>
              <div className="row"><h3 style={{ flex: 1 }}>{e.title}</h3><span className={`badge ${st[1]}`}>{st[0]}</span></div>
              <p className="small muted">{s?.name} · {e.questions} preguntas{e.duration_min ? ` · ⏱ ${e.duration_min} min` : ''}</p>
              {e.closes_at && <p className="small">Cierra: {fmtDateTime(e.closes_at)}</p>}
              {e.instructions && <p className="small" style={{ marginTop: 6 }}>{e.instructions}</p>}
              {e.score != null && (
                <div style={{ marginTop: 10 }}>
                  <div className="row"><strong style={{ fontSize: '1.5rem' }}>{e.score} / {e.max_score}</strong><span className="spacer" />{e.grade != null && <span className="badge ok">Nota {e.grade}</span>}</div>
                  <Progress value={(100 * e.score) / (e.max_score || 1)} />
                </div>
              )}
              <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                {submitted ? <GlowButton size="sm" onClick={() => setResult({ id: e.id })}>Ver resultado</GlowButton>
                  : canTake ? (
                    notYet ? <span className="small muted">Abre {fmtDateTime(e.opens_at)}</span>
                      : closed && e.status === 'sin_iniciar' ? <span className="badge bad">Cerrado</span>
                        : <GlowButton variant="solid" onClick={() => setTaking(e.id)}>{e.status === 'en_curso' ? 'Continuar' : '▶ Presentar examen'}</GlowButton>
                  ) : <span className="small muted">{closed ? 'Cerrado sin presentar' : 'Pendiente por presentar'}</span>}
              </div>
            </motion.div>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

function ExamTaker({ examId, onDone, onExit }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [i, setI] = useState(0);
  const [saving, setSaving] = useState(false);
  const [left, setLeft] = useState(null);
  const timers = useRef({});
  const submittedRef = useRef(false);

  useEffect(() => {
    rpc('cg_exam_start', { p_exam: examId }).then((d) => {
      if (d.attempt.submitted_at) { onDone({ examId, result: null }); return; }
      setData(d); setAnswers(d.attempt.answers || {});
    }).catch((e) => { toast(e); onExit(); });
  }, [examId]); // eslint-disable-line

  // cronómetro: al llegar a cero entrega automáticamente
  useEffect(() => {
    const dl = data?.attempt.deadline || data?.exam.closes_at;
    if (!dl) return;
    const tick = () => {
      const s = Math.floor((new Date(dl) - Date.now()) / 1000);
      setLeft(s);
      if (s <= 0 && !submittedRef.current) { submittedRef.current = true; submit(true); }
    };
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [data]); // eslint-disable-line

  const persist = async (qid, ans, final = false) => {
    setSaving(true);
    try {
      const r = await rpc('cg_exam_save_answer', { p_exam: examId, p_question: qid, p_answer: { choice: ans.choice || [], pages: ans.pages || [] }, p_final: final });
      setAnswers((x) => ({ ...x, [qid]: { ...x[qid], locked: r.locked } }));
    } catch (e) { toast(e); } finally { setSaving(false); }
  };
  const change = (qid, patch, debounce = 0) => {
    const next = { ...(answers[qid] || {}), ...patch };
    setAnswers((x) => ({ ...x, [qid]: next }));
    clearTimeout(timers.current[qid]);
    timers.current[qid] = setTimeout(() => persist(qid, next), debounce);
  };
  const submit = async (auto) => {
    if (!auto && !window.confirm('¿Entregar el examen? Después no podrás cambiar tus respuestas.')) return;
    submittedRef.current = true;
    try {
      // guarda pendientes antes de entregar
      for (const [qid, t] of Object.entries(timers.current)) { clearTimeout(t); if (answers[qid]) await persist(qid, answers[qid]); }
      const result = await rpc('cg_exam_submit', { p_exam: examId });
      onDone({ examId, result });
    } catch (e) { submittedRef.current = false; toast(e); }
  };

  if (!data) return <Spinner />;
  const qs = data.questions;
  const x = qs[i];
  const a = answers[x.id] || {};
  const locked = !data.exam.allow_edit && a.locked;
  const answered = (qq) => { const v = answers[qq.id]; return v && ((v.choice || []).length || (v.pages || []).some(Boolean)); };
  const pick = (k) => {
    if (locked) return;
    const cur = a.choice || [];
    const choice = x.kind === 'unica' ? [k] : cur.includes(k) ? cur.filter((c) => c !== k) : [...cur, k].sort();
    change(x.id, { choice });
  };
  const mm = left != null ? `${Math.max(0, Math.floor(left / 60))}:${String(Math.max(0, left % 60)).padStart(2, '0')}` : null;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <h2 style={{ flex: 1 }}>{data.exam.title}</h2>
        {saving ? <span className="badge">Guardando…</span> : <span className="badge ok">✓ Guardado</span>}
        {mm && <motion.span className={`badge ${left < 120 ? 'bad' : 'info'}`} animate={left < 60 ? { scale: [1, 1.12, 1] } : {}} transition={{ repeat: Infinity, duration: 1 }} style={{ fontSize: '1rem' }}>⏱ {mm}</motion.span>}
      </div>
      <div className="q-dots">
        {qs.map((qq, k) => (
          <motion.button key={qq.id} whileTap={{ scale: 0.85 }} className={`q-dot ${k === i ? 'cur' : ''} ${answered(qq) ? 'done' : ''}`} onClick={() => setI(k)}>{k + 1}</motion.button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={x.id} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.25 }}>
          <Card glow>
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="badge info">Pregunta {i + 1} de {qs.length}</span>
              <span className="badge">{KIND_LABEL[x.kind]}{x.justify ? ' + justificación' : ''}</span>
              <span className="badge">{x.points} pts</span>
              {locked && <span className="badge warn">🔒 Respuesta confirmada</span>}
            </div>
            <p style={{ fontSize: '1.08rem', whiteSpace: 'pre-wrap', marginBottom: 14 }}>{x.prompt}</p>
            {x.kind !== 'cuaderno' && (
              <div className="col" style={{ gap: 8 }}>
                {x.kind === 'multiple' && <span className="small muted">Puedes marcar varias opciones</span>}
                {x.options.map((o, k) => {
                  const on = (a.choice || []).includes(k);
                  return (
                    <motion.button key={k} type="button" disabled={locked} whileHover={!locked ? { x: 4 } : {}} whileTap={!locked ? { scale: 0.98 } : {}} className={`opt pick ${on ? 'chosen' : ''}`} onClick={() => pick(k)}>
                      <span className={`opt-mark ${on ? 'on' : ''} ${x.kind === 'unica' ? 'round' : ''}`}>{on ? '✓' : letter(k)}</span>{o}
                    </motion.button>
                  );
                })}
              </div>
            )}
            {(x.kind === 'cuaderno' || x.justify) && (
              <div style={{ marginTop: 14 }}>
                <p className="small muted" style={{ marginBottom: 6 }}>📓 {x.kind === 'cuaderno' ? 'Resuelve en el cuaderno. Puedes usar varias hojas.' : 'Justifica tu respuesta en el cuaderno.'}</p>
                <Notebook key={x.id} value={a.pages || []} readOnly={locked} onChange={(pages) => change(x.id, { pages }, 1200)} />
              </div>
            )}
          </Card>
        </motion.div>
      </AnimatePresence>
      <div className="row">
        <GlowButton variant="ghost" disabled={i === 0} onClick={() => setI(i - 1)}>← Anterior</GlowButton>
        <span className="spacer" />
        {!data.exam.allow_edit && !locked && <GlowButton variant="warn" disabled={!answered(x)} onClick={() => persist(x.id, a, true)}>🔒 Confirmar respuesta</GlowButton>}
        {i < qs.length - 1 ? <GlowButton onClick={() => setI(i + 1)}>Siguiente →</GlowButton> : <GlowButton variant="ok" size="lg" onClick={() => submit(false)}>📤 Entregar examen</GlowButton>}
      </div>
      {!data.exam.allow_edit && <p className="small muted">El docente definió que cada respuesta confirmada no se puede modificar.</p>}
    </div>
  );
}

function ExamResult({ examId, studentId, initial, onBack }) {
  const toast = useToast();
  const [r, setR] = useState(initial || null);
  useEffect(() => { if (!initial) rpc('cg_exam_result', { p_exam: examId, p_student: studentId }).then(setR).catch(toast); }, [examId]); // eslint-disable-line
  if (!r) return <Spinner />;
  const pct = r.visible && r.max_score ? (100 * (r.score ?? r.auto_score ?? 0)) / r.max_score : null;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row"><GlowButton size="sm" variant="ghost" onClick={onBack}>← Volver</GlowButton><span className="spacer" /><span className={`badge ${STATUS[r.status]?.[1]}`}>{STATUS[r.status]?.[0]}</span></div>
      <Card glow>
        <div className="col" style={{ alignItems: 'center', textAlign: 'center', padding: 10 }}>
          {!r.visible ? (
            <><motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 2.5 }} style={{ fontSize: 56 }}>⏳</motion.div>
              <h2>Examen entregado</h2><p className="muted">El docente publicará el resultado cuando termine de revisarlo.</p></>
          ) : (
            <>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }} style={{ fontSize: 56 }}>{r.status === 'calificado' ? (pct >= 60 ? '🎉' : '📘') : '✍️'}</motion.div>
              <h1 className="grad-text" style={{ fontSize: '2.6rem' }}><AnimatedNumber value={r.score ?? r.auto_score ?? 0} decimals={1} /> / {r.max_score}</h1>
              {r.status === 'pendiente' && <p className="muted">Puntaje de las preguntas calificadas automáticamente. Las preguntas con cuaderno o justificación esperan la validación del docente.</p>}
              {r.grade != null && <span className="badge ok" style={{ fontSize: '1rem' }}>Nota: {r.grade}</span>}
              <div style={{ width: '100%', maxWidth: 420 }}><Progress value={pct} /></div>
              {r.feedback && <p style={{ marginTop: 8 }}>💬 {r.feedback}</p>}
            </>
          )}
        </div>
      </Card>
      {r.questions?.map((x, i) => {
        const ans = x.answer || {};
        return (
          <Card key={x.id} delay={i * 0.04}>
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="badge info">P{i + 1}</span>
              {x.pending ? <span className="badge warn">Esperando validación del docente</span>
                : x.auto_ok === true ? <span className="badge ok">Correcta</span> : x.auto_ok === false ? <span className="badge bad">Incorrecta</span> : null}
              <span className="spacer" />{x.earned != null && <strong>{x.earned} / {x.points}</strong>}
            </div>
            <p style={{ whiteSpace: 'pre-wrap', marginBottom: 10 }}>{x.prompt}</p>
            {x.kind !== 'cuaderno' && (
              <div className="col" style={{ gap: 6 }}>
                {x.options.map((o, k) => {
                  const chosen = (ans.choice || []).includes(k); const right = x.correct?.includes(k);
                  return <div key={k} className={`opt ${chosen ? 'chosen' : ''} ${x.correct ? (right ? 'right' : chosen ? 'wrong' : '') : ''}`}><b>{letter(k)}.</b> {o}{x.correct && right ? ' ✓' : ''}</div>;
                })}
              </div>
            )}
            {(x.kind === 'cuaderno' || x.justify) && ans.pages?.some(Boolean) && <div style={{ marginTop: 10 }}><Notebook value={ans.pages} readOnly height={420} /></div>}
          </Card>
        );
      })}
    </div>
  );
}
