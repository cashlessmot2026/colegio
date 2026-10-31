import { lazy, Suspense, useEffect, useState } from 'react';
import { AuthProvider, DataProvider, useAuth } from './context.jsx';
import { ToastProvider, Spinner } from './components/ui.jsx';
import Login from './pages/Login.jsx';

const Admin = lazy(() => import('./pages/Admin.jsx'));
const Teacher = lazy(() => import('./pages/Teacher.jsx'));
const Family = lazy(() => import('./pages/Family.jsx'));
const Guard = lazy(() => import('./pages/Guard.jsx'));
const Enrollment = lazy(() => import('./pages/Enrollment.jsx'));

const useHash = () => {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => setH(location.hash); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return h;
};

function Router() {
  const hash = useHash();
  const { profile, ready } = useAuth();
  // Enlace externo de matrículas: público, no requiere sesión
  if (hash.startsWith('#/matricula')) return <Enrollment />;
  if (!ready) return <div className="login-wrap"><Spinner /></div>;
  const guardMode = hash.startsWith('#/vigilante');
  if (!profile) return <Login mode={guardMode ? 'guard' : 'main'} />;
  const page = guardMode && ['guard', 'admin'].includes(profile.role) ? <Guard /> : {
    admin: <Admin />, teacher: <Teacher />, parent: <Family />, student: <Family />, guard: <Guard />,
  }[profile.role];
  return <DataProvider>{page}</DataProvider>;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Suspense fallback={<div className="login-wrap"><Spinner /></div>}><Router /></Suspense>
      </AuthProvider>
    </ToastProvider>
  );
}
