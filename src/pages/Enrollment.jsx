import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { rpc, upload } from '../lib/supabase.js';
import SignaturePad from '../components/SignaturePad.jsx';
import { Card, Tabs, GlowButton, Field, Empty, Spinner, EnrollTimeline, useToast } from '../components/ui.jsx';
import { EPS } from '../lib/eps.js';

const GRADES = ['Transición', '1°', '2°', '3°', '4°', '5°', '6°', '7°', '8°', '9°', '10°', '11°'];
const STEPS = ['Estudiante', 'Acudientes', 'Documentos', 'Firmas'];

// Enlace externo y público: formulario de matrícula + consulta de estado
export default function Enrollment() {
  const [tab, setTab] = useState(location.hash.includes('estado') ? 'estado' : 'nueva');
  const [cfg, setCfg] = useState(null);
  useEffect(() => { rpc('cg_enrollment_config').then(setCfg).catch(() => setCfg({ open: false, required_docs: [], school: 'Colegio' })); }, []);
  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 16px 60px' }}>
      <motion.div className="row" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 18 }}>
        <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} width="48" alt="" />
        <div style={{ flex: 1 }}><h1 className="grad-text">Proceso de matrícula</h1><p className="muted small">{cfg?.school || ''}</p></div>
        <a className="small" href="#/">Ingresar a la plataforma →</a>
      </motion.div>
      <Tabs tabs={[{ key: 'nueva', label: '📝 Nueva inscripción' }, { key: 'estado', label: '🔎 Consultar estado' }]} value={tab} onChange={setTab} />
      {!cfg ? <Spinner /> : tab === 'nueva' ? <NewEnrollment cfg={cfg} /> : <Status />}
    </div>
  );
}

function NewEnrollment({ cfg }) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [d, setD] = useState({ guardian2: {} });
  const [files, setFiles] = useState({});
  const [sig, setSig] = useState({ parent: null, student: null });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });
  const setG = (k) => (e) => setD({ ...d, guardian2: { ...d.guardian2, [k]: e.target.value } });

  if (!cfg.open) return <Card><Empty icon="🔒">Las inscripciones están cerradas en este momento.</Empty></Card>;
  if (done) return (
    <Card glow>
      <motion.div className="col" style={{ alignItems: 'center', textAlign: 'center', padding: 20 }} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring' }}>
        <motion.div initial={{ rotate: -90, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', delay: 0.2 }} style={{ fontSize: 64 }}>🎉</motion.div>
        <h2>¡Solicitud enviada!</h2>
        <p className="muted">Guarde este código para consultar el estado de la matrícula:</p>
        <motion.div className="card glow" style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '.15em' }} animate={{ boxShadow: ['0 0 10px #7c5cff', '0 0 40px #00e5ff', '0 0 10px #7c5cff'] }} transition={{ repeat: Infinity, duration: 2 }}>{done}</motion.div>
        <EnrollTimeline status="inscripcion" history={[{ status: 'inscripcion', at: new Date().toISOString(), note: 'Solicitud recibida' }]} />
      </motion.div>
    </Card>
  );

  const next = (e) => {
    e.preventDefault();
    if (step === 2) {
      const missing = (cfg.required_docs || []).filter((r) => !files[r]);
      if (missing.length) return toast(new Error(`Falta adjuntar: ${missing.join(', ')}`));
    }
    setStep(step + 1);
  };
  const submit = async () => {
    if (!sig.parent || !sig.student) return toast(new Error('Faltan las firmas del acudiente y del estudiante'));
    setBusy(true);
    try {
      const folder = crypto.randomUUID();
      const uploaded = [];
      for (const [label, file] of Object.entries(files)) { const u = await upload('colegio-matriculas', file, folder); uploaded.push({ ...u, label }); }
      const code = await rpc('cg_submit_enrollment', { p_data: d, p_files: uploaded, p_sig_parent: sig.parent, p_sig_student: sig.student });
      setDone(code);
    } catch (err) { toast(err); } finally { setBusy(false); }
  };

  return (
    <Card glow>
      <div className="row" style={{ marginBottom: 18, gap: 0 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ flex: 1, textAlign: 'center' }}>
            <motion.div animate={{ background: i <= step ? 'linear-gradient(135deg,#7c5cff,#00e5ff)' : '#15152e', scale: i === step ? 1.12 : 1 }} style={{ width: 34, height: 34, borderRadius: '50%', margin: '0 auto', display: 'grid', placeItems: 'center', fontWeight: 700, boxShadow: i <= step ? '0 0 16px rgba(0,229,255,.5)' : 'none' }}>{i < step ? '✓' : i + 1}</motion.div>
            <span className="small muted">{s}</span>
          </div>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.form key={step} onSubmit={next} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="col">
          {step === 0 && (
            <fieldset><legend>🎒 Datos del estudiante</legend>
              <Field label="Nombre completo"><input required value={d.student_name || ''} onChange={set('student_name')} /></Field>
              <Field label="Documento (RC / TI)"><input required value={d.student_doc || ''} onChange={set('student_doc')} /></Field>
              <Field label="Fecha de nacimiento"><input type="date" required value={d.birth_date || ''} onChange={set('birth_date')} /></Field>
              <Field label="Grado al que aspira"><select required value={d.grade || ''} onChange={set('grade')}><option value="">Seleccione…</option>{GRADES.map((g) => <option key={g}>{g}</option>)}</select></Field>
              <Field label="Colegio de procedencia"><input value={d.previous_school || ''} onChange={set('previous_school')} /></Field>
              <Field label="Dirección de residencia"><input value={d.address || ''} onChange={set('address')} /></Field>
              <Field label="EPS o seguro médico"><input list="eps-enroll" value={d.eps || ''} onChange={set('eps')} /><datalist id="eps-enroll">{EPS.map((x) => <option key={x} value={x} />)}</datalist></Field>
              <Field label="Clínica de traslado (opcional)"><input value={d.clinic || ''} onChange={set('clinic')} /></Field>
            </fieldset>
          )}
          {step === 1 && (
            <>
              <fieldset><legend>👤 Padre, madre o representante</legend>
                <Field label="Nombre completo"><input required value={d.parent_name || ''} onChange={set('parent_name')} /></Field>
                <Field label="Documento"><input required value={d.parent_doc || ''} onChange={set('parent_doc')} /></Field>
                <Field label="Parentesco"><input required value={d.parent_relation || ''} onChange={set('parent_relation')} placeholder="Madre, padre, tutor…" /></Field>
                <Field label="Teléfono"><input type="tel" required value={d.parent_phone || ''} onChange={set('parent_phone')} /></Field>
                <Field label="Correo"><input type="email" required value={d.parent_email || ''} onChange={set('parent_email')} /></Field>
              </fieldset>
              <fieldset><legend>👥 Segundo responsable</legend>
                <Field label="Nombre"><input value={d.guardian2.name || ''} onChange={setG('name')} /></Field>
                <Field label="Parentesco"><input value={d.guardian2.relation || ''} onChange={setG('relation')} /></Field>
                <Field label="Teléfono"><input type="tel" value={d.guardian2.phone || ''} onChange={setG('phone')} /></Field>
                <Field label="Correo"><input type="email" value={d.guardian2.email || ''} onChange={setG('email')} /></Field>
              </fieldset>
            </>
          )}
          {step === 2 && (
            <fieldset><legend>📎 Documentos requeridos por el colegio</legend>
              {(cfg.required_docs || []).length === 0 && <p className="muted small full">El colegio no exige documentos adjuntos.</p>}
              {(cfg.required_docs || []).map((r) => (
                <Field key={r} label={<span>{r} {files[r] && <span className="badge ok">✓</span>}</span>} className="full">
                  <input type="file" accept=".pdf,image/*" onChange={(e) => setFiles({ ...files, [r]: e.target.files[0] })} />
                </Field>
              ))}
              <Field label="Otros (diplomas, certificados adicionales)" className="full"><input type="file" accept=".pdf,image/*" onChange={(e) => e.target.files[0] && setFiles({ ...files, ['Adicional: ' + e.target.files[0].name]: e.target.files[0] })} /></Field>
            </fieldset>
          )}
          {step === 3 && (
            <div className="col">
              <p className="small muted">Al firmar, declaran que la información suministrada es verídica y autorizan el tratamiento de datos personales (Ley 1581 de 2012). El responsable del colegio firmará al aprobar la matrícula.</p>
              <div className="grid g2">
                <SignaturePad label="Firma del padre, madre o representante" onChange={(v) => setSig((s) => ({ ...s, parent: v }))} />
                <SignaturePad label="Firma del estudiante" onChange={(v) => setSig((s) => ({ ...s, student: v }))} />
              </div>
            </div>
          )}
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            {step > 0 ? <GlowButton type="button" variant="ghost" onClick={() => setStep(step - 1)}>← Atrás</GlowButton> : <span />}
            {step < 3 ? <GlowButton variant="solid" type="submit">Siguiente →</GlowButton>
              : <GlowButton variant="ok" size="lg" type="button" onClick={submit} disabled={busy}>{busy ? 'Enviando…' : '✓ Enviar solicitud'}</GlowButton>}
          </div>
        </motion.form>
      </AnimatePresence>
    </Card>
  );
}

function Status() {
  const toast = useToast();
  const [f, setF] = useState({ code: '', doc: '' });
  const [r, setR] = useState(undefined);
  const check = async (e) => {
    e.preventDefault();
    try { const [row] = await rpc('cg_enrollment_status', { p_code: f.code, p_doc: f.doc }); setR(row || null); } catch (err) { toast(err); }
  };
  const LABEL = { inscripcion: 'Inscripción recibida', revision: 'En revisión', entrevista: 'Citado a entrevista', aceptado: '¡Aceptado!', rechazado: 'No admitido' };
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card>
        <form className="form" onSubmit={check}>
          <Field label="Código de matrícula"><input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="MAT-XXXXXX" /></Field>
          <Field label="Documento del estudiante"><input required value={f.doc} onChange={(e) => setF({ ...f, doc: e.target.value })} /></Field>
          <div className="row" style={{ alignItems: 'flex-end' }}><GlowButton variant="solid" type="submit">Consultar</GlowButton></div>
        </form>
      </Card>
      <AnimatePresence mode="wait">
        {r === null && <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Empty icon="🔍">No se encontró una solicitud con esos datos</Empty></motion.div>}
        {r && (
          <motion.div key="ok" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card glow title={`${r.student_name} · Grado ${r.grade}`} actions={<span className={`badge ${r.status === 'aceptado' ? 'ok' : r.status === 'rechazado' ? 'bad' : 'info'}`}>{LABEL[r.status]}</span>}>
              <EnrollTimeline status={r.status} history={r.history} />
              <div className="col" style={{ marginTop: 14, gap: 6 }}>
                {[...r.history].reverse().map((h, i) => <div key={i} className="small"><span className="muted">{new Date(h.at).toLocaleString('es-CO')}</span> · <strong>{LABEL[h.status]}</strong>{h.note ? ` — ${h.note}` : ''}</div>)}
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
