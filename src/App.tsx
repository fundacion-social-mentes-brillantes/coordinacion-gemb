import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { Layout } from './components/Layout';
import { FullScreenSpinner } from './components/Spinner';

// Carga diferida de las pantallas: así las librerías pesadas de exportación
// (PDF) e importación (Excel) NO se descargan hasta que se usan. La toma de
// asistencia (lo más usado en el celular) carga muy ligera.
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const PendingPage = lazy(() =>
  import('./pages/PendingPage').then((m) => ({ default: m.PendingPage })),
);
const SessionsPage = lazy(() =>
  import('./pages/SessionsPage').then((m) => ({ default: m.SessionsPage })),
);
const AttendancePage = lazy(() =>
  import('./pages/AttendancePage').then((m) => ({ default: m.AttendancePage })),
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const MembersPage = lazy(() =>
  import('./pages/MembersPage').then((m) => ({ default: m.MembersPage })),
);
const ImportPage = lazy(() =>
  import('./pages/ImportPage').then((m) => ({ default: m.ImportPage })),
);
const UsersPage = lazy(() =>
  import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

const ALL = ['coordinador', 'admin', 'super_admin'] as const;
const ADMIN = ['admin', 'super_admin'] as const;

export default function App() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        {/* Públicas */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pendiente" element={<PendingPage />} />

        {/* Requieren sesión con rol activo */}
        <Route element={<RequireAuth allow={[...ALL]} />}>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/sesiones" replace />} />
            <Route path="/sesiones" element={<SessionsPage />} />
            <Route path="/sesiones/:id" element={<AttendancePage />} />
            <Route path="/panel" element={<DashboardPage />} />

            {/* Solo administración */}
            <Route element={<RequireAuth allow={[...ADMIN]} />}>
              <Route path="/personas" element={<MembersPage />} />
              <Route path="/personas/importar" element={<ImportPage />} />
              <Route path="/usuarios" element={<UsersPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
