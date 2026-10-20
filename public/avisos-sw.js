/* eslint-disable no-restricted-globals */
// ---------------------------------------------------------------------------
//  Los avisos de la app («Mañana coordinas tú»), dentro del service worker.
//  Lo carga el service worker de la PWA con importScripts (vite.config.ts).
//
//  Llegan cifrados desde api/avisos; el navegador los descifra y aquí solo se
//  muestran. Cada aviso que llega SE MUESTRA SIEMPRE: si no, el iPhone le
//  quita el permiso a la app.
// ---------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { cuerpo: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(d.titulo || 'Coordinación GEMB', {
      body: d.cuerpo || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: d.etiqueta || 'gemb',
      lang: 'es',
      data: { ruta: d.ruta || '/sesiones' },
    }),
  );
});

// Al tocarlo: la app, en la pantalla del aviso (si ya estaba abierta, esa).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.ruta) || '/sesiones', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const v of ventanas) {
        if (new URL(v.url).origin !== self.location.origin) continue;
        await v.focus();
        if ('navigate' in v && v.url !== url) await v.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// La app pregunta si este service worker ya sabe mostrar avisos antes de
// suscribirse (ver swConAvisos en src/services/avisos.ts).
self.addEventListener('message', (event) => {
  if (event.data === 'gemb:avisos?' && event.ports && event.ports[0]) {
    event.ports[0].postMessage('gemb:avisos-si');
  }
});
