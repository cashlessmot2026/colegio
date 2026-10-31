import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../context.jsx';
import { GlowButton, Field } from '../components/ui.jsx';

export default function Login({ mode }) {
  const { signIn, kicked } = useAuth();
  const [f, setF] = useState({ u: '', p: '' });
  const [err, setErr] = useState(kicked);
  const [busy, setBusy] = useState(false);
  const [installEvt, setInstallEvt] = useState(null);
  useEffect(() => setErr(kicked), [kicked]);
  useEffect(() => {
    const h = (e) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await signIn(f.u, f.p); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  const guard = mode === 'guard';

  return (
    <div className="login-wrap">
      <motion.div className="login" initial={{ opacity: 0, y: 30, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
        <div className="card glow" style={{ padding: 28 }}>
          <motion.img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" width="74" style={{ display: 'block', margin: '0 auto 12px' }}
            animate={{ y: [0, -6, 0], filter: ['drop-shadow(0 0 8px #7c5cff)', 'drop-shadow(0 0 22px #00e5ff)', 'drop-shadow(0 0 8px #7c5cff)'] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }} />
          <h1 style={{ textAlign: 'center' }} className="grad-text">{guard ? 'Portería · Vigilancia' : 'Colegio App'}</h1>
          <p className="muted small" style={{ textAlign: 'center', marginTop: 6 }}>
            {guard ? 'Control de salida de estudiantes' : 'Ingrese con el usuario y la contraseña asignados por el colegio'}
          </p>
          {!guard && (
            <div className="grid g4" style={{ gridTemplateColumns: 'repeat(4,1fr)', gap: 6, margin: '18px 0 6px' }}>
              {[['👨‍👩‍👧', 'Padres'], ['🧑‍🏫', 'Docentes'], ['🎒', 'Estudiantes'], ['🏫', 'Colegio']].map(([i, l], k) => (
                <motion.div key={l} className="role-chip" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + k * 0.07 }}>
                  <div style={{ fontSize: 20 }}>{i}</div>{l}
                </motion.div>
              ))}
            </div>
          )}
          <form className="col" style={{ marginTop: 14 }} onSubmit={submit}>
            <Field label="Usuario"><input autoComplete="username" required value={f.u} onChange={(e) => setF({ ...f, u: e.target.value })} autoCapitalize="none" /></Field>
            <Field label="Contraseña"><input type="password" autoComplete="current-password" required value={f.p} onChange={(e) => setF({ ...f, p: e.target.value })} /></Field>
            {err && <motion.p className="small" style={{ color: 'var(--bad)' }} initial={{ x: -8 }} animate={{ x: [8, -6, 4, 0] }}>{err}</motion.p>}
            <GlowButton variant="solid" size="lg" type="submit" disabled={busy}>{busy ? 'Verificando…' : 'Ingresar'}</GlowButton>
          </form>
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            {installEvt && <GlowButton size="sm" variant="ok" onClick={() => installEvt.prompt()}>⬇ Instalar app</GlowButton>}
            {!guard && <a className="small" href="#/matricula">📝 Proceso de matrícula</a>}
            {guard && <a className="small" href="#/">← Plataforma principal</a>}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
