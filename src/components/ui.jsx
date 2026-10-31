import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { levelFor, fmt } from '../lib/grading.js';

export const spring = { type: 'spring', stiffness: 380, damping: 30 };

// Botón retroiluminado (borde de luz giratorio + resplandor) con física de Motion
export function GlowButton({ children, variant = '', size = '', className = '', ...p }) {
  return (
    <motion.button
      whileHover={{ scale: 1.04, y: -1 }}
      whileTap={{ scale: 0.95 }}
      transition={spring}
      className={`gbtn ${variant} ${size} ${className}`}
      {...p}
    >
      {children}
    </motion.button>
  );
}

export function Card({ title, actions, children, glow, className = '', delay = 0, ...p }) {
  return (
    <motion.section
      className={`card ${glow ? 'glow' : ''} ${className}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      {...p}
    >
      {(title || actions) && (
        <div className="card-h"><h3>{title}</h3>{actions}</div>
      )}
      {children}
    </motion.section>
  );
}

export function Tabs({ tabs, value, onChange }) {
  const id = useId();
  const box = useRef(null);
  // la pestaña activa siempre queda visible (en celular la lista se desplaza sola)
  useEffect(() => {
    const el = box.current?.querySelector('[aria-selected="true"]');
    if (el && box.current.scrollWidth > box.current.clientWidth) {
      box.current.scrollTo({ left: el.offsetLeft - box.current.clientWidth / 2 + el.offsetWidth / 2, behavior: 'smooth' });
    }
  }, [value]);
  return (
    <div className="tabs" role="tablist" ref={box}>
      {tabs.map((t) => {
        const key = typeof t === 'string' ? t : t.key;
        const label = typeof t === 'string' ? t : t.label;
        return (
          <button key={key} role="tab" aria-selected={value === key} className={`tab ${value === key ? 'active' : ''}`} onClick={() => onChange(key)}>
            {value === key && <motion.span layoutId={`tab-${id}`} className="pill" transition={spring} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return;
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
          <motion.div className="modal" style={wide ? { width: 'min(1000px,100%)' } : undefined}
            initial={{ scale: 0.9, y: 30, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, y: 20, opacity: 0 }} transition={spring}>
            <div className="modal-h"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button></div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const Field = ({ label, className = '', children }) => <label className={`f ${className}`}>{label}{children}</label>;

export function Empty({ icon = '🗂️', children }) {
  return <motion.div className="empty" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}><div className="e">{icon}</div>{children}</motion.div>;
}

export const Spinner = () => <div className="spin" aria-label="Cargando" />;

// lista con entrada escalonada
export function Stagger({ children, className = 'col', gap }) {
  return (
    <motion.div className={className} style={gap ? { gap } : undefined} initial="h" animate="s"
      variants={{ s: { transition: { staggerChildren: 0.045 } } }}>
      {children}
    </motion.div>
  );
}
export const StaggerItem = ({ children, className, ...p }) => (
  <motion.div className={className} variants={{ h: { opacity: 0, y: 12 }, s: { opacity: 1, y: 0 } }} {...p}>{children}</motion.div>
);

export function Progress({ value }) {
  return <div className="bar"><motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} /></div>;
}

export function Avatar({ name = '?', size = 42 }) {
  const ini = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>{ini}</div>;
}

export function GradeBadge({ value, scale }) {
  const l = levelFor(value, scale);
  if (!l) return <span className="badge">—</span>;
  return <span className="badge" style={{ color: l.color, borderColor: l.color + '66', background: l.color + '1f' }}>{fmt(value, scale)} · {l.name}</span>;
}

export function AnimatedNumber({ value, decimals = 0 }) {
  const [v, setV] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (value == null || Number.isNaN(Number(value))) return;
    if (reduce) { setV(Number(value)); return; }
    let raf; const start = performance.now(); const from = 0; const to = Number(value);
    const step = (t) => { const k = Math.min(1, (t - start) / 800); setV(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce]);
  if (value == null || Number.isNaN(Number(value))) return <>—</>;
  return <>{v.toFixed(decimals)}</>;
}

export function Kpi({ icon, label, value, decimals = 0, suffix = '', delay = 0 }) {
  return (
    <Card delay={delay}>
      <div className="row" style={{ gap: 14 }}>
        <div className="kpi-ico">{icon}</div>
        <div className="stat"><span className="muted small">{label}</span><span className="v"><AnimatedNumber value={value} decimals={decimals} />{value != null && suffix}</span></div>
      </div>
    </Card>
  );
}

// Gráfico de barras animado (SVG)
export function Bars({ data, max, height = 190, format = (v) => v, color }) {
  const m = max ?? Math.max(1, ...data.map((d) => d.value || 0));
  if (!data.length) return <Empty icon="📊">Sin datos todavía</Empty>;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: height + 40, overflowX: 'auto', paddingTop: 10 }}>
      {data.map((d, i) => {
        const h = Math.max(4, ((d.value || 0) / m) * height);
        return (
          <div key={d.label + i} style={{ flex: 1, minWidth: 46, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <span className="small" style={{ fontWeight: 700 }}>{d.value == null ? '—' : format(d.value)}</span>
            <motion.div title={d.label} initial={{ height: 0 }} animate={{ height: h }} transition={{ duration: 0.8, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
              style={{ width: '70%', maxWidth: 44, borderRadius: '10px 10px 4px 4px', background: d.color || color || 'linear-gradient(180deg,var(--b),var(--a))', boxShadow: '0 0 16px rgba(124,92,255,.45)' }} />
            <span className="small muted" style={{ textAlign: 'center', lineHeight: 1.1 }}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg: msg instanceof Error ? msg.message : msg, kind: msg instanceof Error ? 'bad' : kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div key={t.id} className={`toast ${t.kind}`} layout initial={{ opacity: 0, x: 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 60 }} transition={spring}>
              {t.kind === 'bad' ? '⚠️ ' : t.kind === 'info' ? '🔔 ' : '✅ '}{t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Carga de datos ----------
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const alive = useRef(true);
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try { const data = await fn(); if (alive.current) setState({ data, loading: false, error: null }); }
    catch (error) { if (alive.current) setState({ data: null, loading: false, error }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { alive.current = true; run(); return () => { alive.current = false; }; }, [run]);
  return { ...state, reload: run };
}

export function Async({ state, children }) {
  if (state.loading && !state.data) return <Spinner />;
  if (state.error) return <Empty icon="⚠️">{state.error.message}</Empty>;
  return children(state.data);
}

// Línea de tiempo de matrícula
export const ENROLL_STEPS = [
  { key: 'inscripcion', label: 'Inscripción', icon: '📝' },
  { key: 'revision', label: 'Revisión', icon: '🔎' },
  { key: 'entrevista', label: 'Entrevista', icon: '🗣️' },
  { key: 'final', label: 'Decisión', icon: '🏁' },
];
export function EnrollTimeline({ status, history = [] }) {
  const order = { inscripcion: 0, revision: 1, entrevista: 2, aceptado: 3, rechazado: 3 };
  const idx = order[status] ?? 0;
  const hadInterview = history.some((h) => h.status === 'entrevista');
  return (
    <div className="timeline">
      {ENROLL_STEPS.map((s, i) => {
        const done = i <= idx;
        const final = s.key === 'final';
        const reject = final && status === 'rechazado';
        const skipped = s.key === 'entrevista' && idx >= 3 && !hadInterview;
        const h = [...history].reverse().find((x) => (final ? ['aceptado', 'rechazado'].includes(x.status) : x.status === s.key));
        return (
          <motion.div key={s.key} className={`tl-step ${done ? 'done' : ''} ${reject ? 'reject' : ''}`}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.12 }}>
            <motion.div className="tl-dot" animate={i === idx ? { scale: [1, 1.15, 1] } : {}} transition={{ repeat: Infinity, duration: 1.8 }}>
              {final && done ? (reject ? '✕' : '✓') : s.icon}
            </motion.div>
            <strong className="small">{final && done ? (reject ? 'Rechazado' : 'Aceptado') : s.label}{skipped ? ' (no aplica)' : ''}</strong>
            {h && <span className="small muted">{new Date(h.at).toLocaleDateString('es-CO')}{h.note ? ` · ${h.note}` : ''}</span>}
          </motion.div>
        );
      })}
    </div>
  );
}

// Check animado verde / X roja (vigilancia)
export function Verdict({ ok, title, children }) {
  return (
    <motion.div className={`verdict ${ok ? 'ok' : 'bad'}`} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
      <svg width="170" height="170" viewBox="0 0 100 100">
        <motion.circle cx="50" cy="50" r="44" fill="none" stroke={ok ? '#3ddc97' : '#ff4d6d'} strokeWidth="6"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6 }} style={{ filter: `drop-shadow(0 0 10px ${ok ? '#3ddc97' : '#ff4d6d'})` }} />
        {ok ? (
          <motion.path d="M30 52 L44 66 L72 36" fill="none" stroke="#3ddc97" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.5, duration: 0.45 }} />
        ) : (
          <>
            <motion.path d="M34 34 L66 66" stroke="#ff4d6d" strokeWidth="8" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.5, duration: 0.3 }} />
            <motion.path d="M66 34 L34 66" stroke="#ff4d6d" strokeWidth="8" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.75, duration: 0.3 }} />
          </>
        )}
      </svg>
      <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} style={{ color: ok ? 'var(--ok)' : 'var(--bad)' }}>{title}</motion.h1>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95 }}>{children}</motion.div>
    </motion.div>
  );
}
