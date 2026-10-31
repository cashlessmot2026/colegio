import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase, q, rpc, usernameToEmail } from './lib/supabase.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);
const NONCE_KEY = 'colegio-session-nonce';

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(false);
  const [kicked, setKicked] = useState('');

  const loadProfile = useCallback(async (user) => {
    if (!user) { setProfile(null); return; }
    const p = await q(supabase.from('profiles').select('*').eq('id', user.id).single()).catch(() => null);
    setProfile(p);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => { await loadProfile(data.session?.user); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((ev, session) => {
      if (ev === 'SIGNED_OUT') setProfile(null);
      if (ev === 'SIGNED_IN' || ev === 'USER_UPDATED') setTimeout(() => loadProfile(session?.user), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  // Sesión única: si el usuario inicia sesión en otro dispositivo, esta sesión se cierra
  useEffect(() => {
    if (!profile) return;
    const check = async () => {
      const n = localStorage.getItem(NONCE_KEY);
      // sin marca local todavía (el inicio de sesión aún la está registrando): no se expulsa
      if (!n) return;
      const ok = await rpc('cg_session_valid', { n }).catch(() => true);
      if (!ok) { await supabase.auth.signOut(); localStorage.removeItem(NONCE_KEY); setKicked('Su sesión se cerró porque la cuenta se abrió en otro dispositivo o se cambió la contraseña.'); }
    };
    check();
    const t = setInterval(check, 30000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [profile]);

  const signIn = async (username, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
    if (error) throw new Error(/Invalid login/i.test(error.message) ? 'Usuario o contraseña incorrectos' : error.message);
    const nonce = await rpc('cg_claim_session');
    localStorage.setItem(NONCE_KEY, nonce);
    setKicked('');
    await loadProfile(data.user);
  };
  const signOut = async () => { localStorage.removeItem(NONCE_KEY); await supabase.auth.signOut(); setProfile(null); };

  return <AuthCtx.Provider value={{ profile, ready, signIn, signOut, kicked, setKicked }}>{children}</AuthCtx.Provider>;
}

// ---------- Datos de referencia (grupos, asignaturas, salones, horario, docentes, ajustes) ----------
const DataCtx = createContext(null);
export const useData = () => useContext(DataCtx);

export function DataProvider({ children }) {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    const [groups, subjects, rooms, schedule, staff, settingsRows] = await Promise.all([
      q(supabase.from('groups').select('*').order('grade').order('name')),
      q(supabase.from('subjects').select('*').order('name')),
      q(supabase.from('rooms').select('*').order('name')),
      q(supabase.from('schedule').select('*').order('day').order('start_time')),
      q(supabase.from('profiles').select('id, full_name, role, username, phone, email, doc_id').in('role', ['teacher', 'admin'])),
      q(supabase.from('cg_settings').select('*')),
    ]);
    const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
    const by = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
    setData({
      groups, subjects, rooms, schedule, staff, settings,
      groupById: by(groups), subjectById: by(subjects), roomById: by(rooms), staffById: by(staff),
      teachers: staff.filter((s) => s.role === 'teacher'),
      school: settings.school || { name: 'Colegio' },
      grading: settings.grading || { scale: '1-5', teacher_can_choose: true },
    });
  }, []);
  useEffect(() => { load().catch(console.error); }, [load]);
  if (!data) return <div className="login-wrap"><div className="spin" /></div>;
  return <DataCtx.Provider value={{ ...data, reload: load }}>{children}</DataCtx.Provider>;
}

// escala efectiva de una asignatura
export const scaleOf = (subject, grading) => (grading?.teacher_can_choose && subject?.scale) || grading?.scale || '1-5';
