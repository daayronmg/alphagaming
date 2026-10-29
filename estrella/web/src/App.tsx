import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import { Login, Register, Forgot, Reset } from './pages/AuthPages';
import Home from './pages/Home';

const Calendar = lazy(() => import('./pages/Calendar'));
const EventDetail = lazy(() => import('./pages/EventDetail'));
const LibraryPage = lazy(() => import('./pages/Library'));
const MarchaDetail = lazy(() => import('./pages/MarchaDetail'));
const PartView = lazy(() => import('./pages/PartView'));
const ScoreView = lazy(() => import('./pages/ScoreView'));
const LiveMember = lazy(() => import('./pages/LiveMember'));
const LiveDirector = lazy(() => import('./pages/LiveDirector'));
const Doubts = lazy(() => import('./pages/Doubts'));
const Announcements = lazy(() => import('./pages/Announcements'));
const Academy = lazy(() => import('./pages/Academy'));
const CourseView = lazy(() => import('./pages/CourseView'));
const LessonView = lazy(() => import('./pages/LessonView'));
const Trainer = lazy(() => import('./pages/Trainer'));
const Tools = lazy(() => import('./pages/Tools'));
const Assistant = lazy(() => import('./pages/Assistant'));
const Members = lazy(() => import('./pages/Members'));
const MemberDetail = lazy(() => import('./pages/MemberDetail'));
const ImportMembers = lazy(() => import('./pages/ImportMembers'));
const Stats = lazy(() => import('./pages/Stats'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Admin = lazy(() => import('./pages/Admin'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Checkin = lazy(() => import('./pages/Checkin'));

function UpdatePrompt() {
  const { needRefresh: [need], updateServiceWorker } = useRegisterSW({ onRegisteredSW() {} });
  if (!need) return null;
  return (
    <div className="toasts"><div className="toast ok"><div className="stack sm"><strong>Nueva versión disponible</strong>
      <button className="btn sm primary" onClick={() => updateServiceWorker(true)}>Actualizar</button></div></div></div>
  );
}

function Private() {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner label="Cargando…" />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <Layout />;
}

export default function App() {
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <>
      <Suspense fallback={<Spinner label="Cargando…" />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/registro" element={<Register />} />
          <Route path="/recuperar" element={<Forgot />} />
          <Route path="/restablecer/:token" element={<Reset />} />
          <Route element={<Private />}>
            <Route index element={<Home />} />
            <Route path="calendario" element={<Calendar />} />
            <Route path="eventos/:id" element={<EventDetail />} />
            <Route path="checkin/:id" element={<Checkin />} />
            <Route path="biblioteca" element={<LibraryPage />} />
            <Route path="marchas/:id" element={<MarchaDetail />} />
            <Route path="partitura/:partId" element={<PartView />} />
            <Route path="score/:scoreId" element={<ScoreView />} />
            <Route path="directo" element={<LiveMember />} />
            <Route path="directo/:id" element={<LiveMember />} />
            <Route path="direccion" element={<LiveDirector />} />
            <Route path="direccion/:id" element={<LiveDirector />} />
            <Route path="dudas" element={<Doubts />} />
            <Route path="dudas/:id" element={<Doubts />} />
            <Route path="avisos" element={<Announcements />} />
            <Route path="academia" element={<Academy />} />
            <Route path="academia/curso/:id" element={<CourseView />} />
            <Route path="academia/leccion/:id" element={<LessonView />} />
            <Route path="academia/entrenamiento" element={<Trainer />} />
            <Route path="academia/herramientas" element={<Tools />} />
            <Route path="asistente" element={<Assistant />} />
            <Route path="componentes" element={<Members />} />
            <Route path="componentes/importar" element={<ImportMembers />} />
            <Route path="componentes/:id" element={<MemberDetail />} />
            <Route path="estadisticas" element={<Stats />} />
            <Route path="inventario" element={<Inventory />} />
            <Route path="admin" element={<Admin />} />
            <Route path="ajustes" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
      <UpdatePrompt />
    </>
  );
}
