import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { markUpdateReady } from './lib/swUpdate';
import './index.css';

/**
 * Registra el service worker (PWA).
 * Cuando hay una versión nueva NO se recarga sola: avisa con un botón para
 * que nadie pierda lo que está haciendo en mitad de una reunión.
 */
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    markUpdateReady();
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    // Busca versión nueva cada hora y al volver a la app.
    const check = () => registration.update().catch(() => {});
    setInterval(check, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});

// La usa el aviso de "Actualizar" del Layout y la pantalla de ingreso.
window.addEventListener('gemb:do-update', () => {
  void updateSW(true);
});

/**
 * Red de seguridad para pantallas en blanco tras una actualización.
 *
 * Las pantallas se cargan por partes. Si el celular tiene guardada una
 * versión vieja, puede pedir un trozo que ya no existe y quedarse en blanco.
 * Aquí se recarga la app una sola vez (más veces sería un bucle).
 */
window.addEventListener('vite:preloadError', (event) => {
  const YA = 'gemb:recarga-por-trozo-perdido';
  try {
    if (sessionStorage.getItem(YA)) return;
    sessionStorage.setItem(YA, '1');
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
