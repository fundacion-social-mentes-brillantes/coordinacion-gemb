import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { Layout } from './components/Layout';
import { FullScreenSpinner } from './components/Spinner';
import { ErrorBoundary } from './components/ErrorBoundary';

// Carga diferida de las pantallas: así las librerías pesadas de exportación
// (PDF) e importación (Excel) NO se descargan hasta que se usan. La toma de
// asistencia (lo más usado en el celular) carga muy ligera.
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const PendingPage = lazy(() =>
  import('./pages/PendingPage').then((m) => ({ default: m.PendingPage })),
);
const PrivacidadPage = lazy(() =>
  import('./pages/LegalPages').then((m) => ({ default: m.PrivacidadPage })),
);
const EliminarCuentaPage = lazy(() =>
  import('./pages/LegalPages').then((m) => ({ default: m.EliminarCuentaPage })),
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
const ReviewPage = lazy(() =>
  import('./pages/ReviewPage').then((m) => ({ default: m.ReviewPage })),
);
const ImportPage = lazy(() =>
  import('./pages/ImportPage').then((m) => ({ default: m.ImportPage })),
);
const ImportHistoryPage = lazy(() =>
  import('./pages/ImportHistoryPage').then((m) => ({
    default: m.ImportHistoryPage,
  })),
);
const UsersPage = lazy(() =>
  import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const AuthorizePage = lazy(() =>
  import('./pages/AuthorizePage').then((m) => ({ default: m.AuthorizePage })),
);
const ConnectPage = lazy(() =>
  import('./pages/ConnectPage').then((m) => ({ default: m.ConnectPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const ProgramacionPage = lazy(() =>
  import('./pages/ProgramacionPage').then((m) => ({ default: m.ProgramacionPage })),
);
const CalendarioPublicoPage = lazy(() =>
  import('./pages/CalendarioPublicoPage').then((m) => ({ default: m.CalendarioPublicoPage })),
);
// La burbuja flotante de la app de Android.
const LayoutBurbuja = lazy(() =>
  import('./pages/BurbujaPage').then((m) => ({ default: m.LayoutBurbuja })),
);
const BurbujaPage = lazy(() =>
  import('./pages/BurbujaPage').then((m) => ({ default: m.BurbujaPage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

const ALL = ['coordinador', 'admin', 'super_admin'] as const;
const ADMIN = ['admin', 'super_admin'] as const;

export default function App() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        {/* Públicas */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pendiente" element={<PendingPage />} />
        {/* Aquí llega quien conecta Claude: entra con Google y vuelve. */}
        <Route path="/autorizar" element={<AuthorizePage />} />
        {/* El calendario público (antes era la app "Calendario"). */}
        <Route path="/calendario" element={<CalendarioPublicoPage />} />
        {/* Lo que exige Google Play: se ven sin entrar. */}
        <Route path="/privacidad" element={<PrivacidadPage />} />
        <Route path="/eliminar-cuenta" element={<EliminarCuentaPage />} />

        {/* Requieren sesión con rol activo */}
        <Route element={<RequireAuth allow={[...ALL]} />}>
          {/* Dentro de la burbuja flotante (app de Android): la reunión de
              hoy y su asistencia, sin la barra de pestañas. */}
          <Route element={<LayoutBurbuja />}>
            <Route path="/burbuja" element={<BurbujaPage />} />
            <Route path="/burbuja/:id" element={<AttendancePage />} />
          </Route>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/sesiones" replace />} />
            <Route path="/sesiones" element={<SessionsPage />} />
            <Route path="/sesiones/:id" element={<AttendancePage />} />
            <Route path="/programacion" element={<ProgramacionPage />} />
            {/* Ajustes y, dentro, conectar con Claude. Fuera de la barra de
                abajo a propósito: se toca una vez y ya. Lo que Claude puede
                hacer depende del rol de cada quien, así que también entran
                las coordinadoras. */}
            <Route path="/ajustes" element={<SettingsPage />} />
            <Route path="/conectar" element={<ConnectPage />} />

            {/* Solo administración (las coordinadoras solo usan Sesiones) */}
            <Route element={<RequireAuth allow={[...ADMIN]} />}>
              <Route path="/panel" element={<DashboardPage />} />
              <Route path="/personas" element={<MembersPage />} />
              <Route path="/personas/revisar" element={<ReviewPage />} />
              <Route path="/personas/importar" element={<ImportPage />} />
              <Route path="/personas/historial" element={<ImportHistoryPage />} />
              <Route path="/usuarios" element={<UsersPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
