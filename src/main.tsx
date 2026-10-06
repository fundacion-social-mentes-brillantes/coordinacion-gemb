import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import { markUpdateReady } from './lib/swUpdate';
// Atrapa desde el arranque el aviso de "se puede instalar" (llega una sola vez).
import './lib/instalar';
import './index.css';

/**
 * Registra el service worker (PWA).
 *
 * Cuando hay una versión nueva NO se recarga en la cara de nadie: avisa con
 * un botón, para que nadie pierda lo que está haciendo en mitad de una
 * reunión. Pero tampoco puede depender solo de ese botón: quien lo ignora se
 * quedaba semanas con la versión vieja (y sin los arreglos). Por eso se
 * instala sola cuando no estorba:
 * - al abrir la app, si la versión nueva llega en los primeros segundos
 *   (todavía no se ha tocado nada);
 * - cuando la app lleva un minuto en segundo plano (lo marcado sin señal está
 *   guardado en el teléfono y no se pierde al recargar).
 */
const ARRANQUE = Date.now();
let hayVersionNueva = false;
let temporizadorFondo: ReturnType<typeof setTimeout> | undefined;

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    hayVersionNueva = true;
    markUpdateReady();
    if (Date.now() - ARRANQUE < 4000) void updateSW(true);
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

// Un minuto en segundo plano con versión nueva esperando → se instala.
document.addEventListener('visibilitychange', () => {
  clearTimeout(temporizadorFondo);
  if (document.visibilityState === 'hidden' && hayVersionNueva) {
    temporizadorFondo = setTimeout(() => void updateSW(true), 60_000);
  }
});

/**
 * Red de seguridad para pantallas en blanco tras una actualización.
 *
 * Las pantallas se cargan por partes. Si el celular tiene guardada una
 * versión vieja, puede pedir un trozo que ya no existe y quedarse en blanco.
 * Aquí se recarga la app. Como mucho una vez por minuto: más seguido sería un
 * bucle, pero "una sola vez por pestaña" dejaba la app en blanco si volvía a
 * pasar más tarde en la misma sesión.
 */
window.addEventListener('vite:preloadError', (event) => {
  const MARCA = 'gemb:recarga-por-trozo-perdido';
  try {
    const ultima = Number(sessionStorage.getItem(MARCA) || 0);
    if (Date.now() - ultima < 60_000) return;
    sessionStorage.setItem(MARCA, String(Date.now()));
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
