import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth, useData } from '../context.jsx';
import { supabase, q } from '../lib/supabase.js';
import { systemNotify, askNotificationPermission } from '../lib/notify.js';
import { fmtDateTime } from '../lib/dates.js';
import { spring, Modal, GlowButton, useToast, Field, Empty } from './ui.jsx';
import { rpc } from '../lib/supabase.js';

const ROLE_LABEL = { admin: 'Administración', teacher: 'Docente', parent: 'Padre de familia', student: 'Estudiante', guard: 'Vigilancia' };

// Contenedor con menú lateral (escritorio) o barra inferior (móvil)
export default function Shell({ nav, active, onNav, title, subtitle, actions, children }) {
  const { profile, signOut } = useAuth();
  const { school } = useData();
  const [notifOpen, setNotifOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const { items, unread, markAll, remove } = useNotifications();

  const NavList = ({ mobile }) => nav.map((n) => (
    <button key={n.key} className={`navbtn ${active === n.key ? 'active' : ''}`} onClick={() => onNav(n.key)}>
      {active === n.key && <motion.span layoutId={mobile ? 'nav-m' : 'nav-d'} className="pill" transition={spring} />}
      <span className="ico">{n.icon}</span><span>{n.label}</span>
      {n.badge > 0 && <span className="dot badge">{n.badge}</span>}
    </button>
  ));

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <img src="/icons/icon.svg" alt="" />
          <div><strong>{school.name}</strong><div className="small muted">{ROLE_LABEL[profile.role]}</div></div>
        </div>
        <NavList />
        <div className="spacer" />
        <div className="card" style={{ padding: 12 }}>
          <div className="small muted">Sesión</div>
          <strong className="small">{profile.full_name}</strong>
          <div className="row" style={{ marginTop: 10 }}>
            {profile.role !== 'student' && <GlowButton size="sm" variant="ghost" onClick={() => setPwOpen(true)}>🔑 Clave</GlowButton>}
            <GlowButton size="sm" variant="bad" onClick={signOut}>Salir</GlowButton>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="title">
            <motion.h1 key={title} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>{title}</motion.h1>
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          {actions}
          <button className="icon-btn" onClick={() => { setNotifOpen(true); askNotificationPermission(); }} aria-label="Notificaciones">
            🔔
            <AnimatePresence>{unread > 0 && (
              <motion.span className="dot" style={{ position: 'absolute', top: -6, right: -6 }} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>{unread}</motion.span>
            )}</AnimatePresence>
          </button>
          <button className="icon-btn mobile-only" onClick={signOut} title="Cerrar sesión" style={{ display: 'none' }}>⏻</button>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={active} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="bottom-nav"><NavList mobile />
        <button className="navbtn" onClick={signOut}><span className="ico">⏻</span><span>Salir</span></button>
      </nav>

      <Modal open={notifOpen} onClose={() => { setNotifOpen(false); markAll(); }} title="Notificaciones">
        {items.length === 0 ? <Empty icon="🔕">Sin notificaciones</Empty> : (
          <div className="col">
            {items.map((n) => (
              <motion.div layout key={n.id} className="list-item" style={!n.read_at ? { borderColor: 'var(--a)' } : undefined}>
                <span style={{ fontSize: 22 }}>{ICON[n.kind] || '🔔'}</span>
                <div style={{ flex: 1 }}><strong>{n.title}</strong><p className="small">{n.body}</p><span className="small muted">{fmtDateTime(n.created_at)}</span></div>
                <button className="icon-btn" onClick={() => remove(n.id)} aria-label="Eliminar">🗑</button>
              </motion.div>
            ))}
          </div>
        )}
      </Modal>
      <PasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

const ICON = { inasistencia: '🚨', salida: '🚪', chat: '💬', clase: '🎥', matricula: '📝', info: 'ℹ️' };

function useNotifications() {
  const { profile } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState([]);
  useEffect(() => {
    let alive = true;
    q(supabase.from('notifications').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(60))
      .then((d) => alive && setItems(d)).catch(() => {});
    const ch = supabase.channel(`notif-${profile.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` }, ({ new: n }) => {
        setItems((x) => [n, ...x]);
        toast(`${n.title}: ${n.body || ''}`, 'info');
        systemNotify(n.title, n.body, n.id);
        if (navigator.vibrate && n.kind === 'inasistencia') navigator.vibrate([200, 100, 200]);
      })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [profile.id, toast]);
  const markAll = async () => {
    const ids = items.filter((i) => !i.read_at).map((i) => i.id);
    if (!ids.length) return;
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
    setItems((x) => x.map((i) => ({ ...i, read_at: i.read_at || new Date().toISOString() })));
  };
  const remove = async (id) => { await supabase.from('notifications').delete().eq('id', id); setItems((x) => x.filter((i) => i.id !== id)); };
  return { items, unread: items.filter((i) => !i.read_at).length, markAll, remove };
}

function PasswordModal({ open, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ old: '', n1: '', n2: '' });
  const save = async (e) => {
    e.preventDefault();
    if (f.n1 !== f.n2) return toast(new Error('Las contraseñas nuevas no coinciden'));
    try {
      await rpc('cg_change_my_password', { old_pw: f.old, new_pw: f.n1 });
      toast('Contraseña actualizada. Inicie sesión de nuevo.');
      setF({ old: '', n1: '', n2: '' }); onClose();
      setTimeout(() => location.reload(), 1200);
    } catch (err) { toast(err); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Cambiar contraseña">
      <form className="col" onSubmit={save}>
        <Field label="Contraseña actual"><input type="password" required value={f.old} onChange={(e) => setF({ ...f, old: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="Nueva contraseña"><input type="password" required minLength={4} value={f.n1} onChange={(e) => setF({ ...f, n1: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="Repetir nueva contraseña"><input type="password" required minLength={4} value={f.n2} onChange={(e) => setF({ ...f, n2: e.target.value })} autoComplete="new-password" /></Field>
        <GlowButton variant="solid" type="submit">Guardar</GlowButton>
      </form>
    </Modal>
  );
}
