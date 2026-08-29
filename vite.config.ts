import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Configuración de Vite + React + PWA.
// La PWA usa `prompt`: cuando hay versión nueva se AVISA con un botón, en vez
// de recargarse sola (recargarse en plena reunión perdería el hilo).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'logo.svg'],
      manifest: {
        name: 'Coordinación GEMB — Asistencia',
        short_name: 'Coordinación',
        description:
          'Control de asistencia — Gimnasio Emocional Mentes Brillantes',
        lang: 'es',
        dir: 'ltr',
        theme_color: '#2b9678',
        background_color: '#f2faf7',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        id: '/',
        start_url: '/sesiones',
        scope: '/',
        categories: ['productivity', 'education'],
        // Atajo al mantener pulsado el icono en Android.
        shortcuts: [
          {
            name: 'Tomar asistencia',
            short_name: 'Asistencia',
            description: 'Abre las sesiones para marcar quién llegó',
            url: '/sesiones',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // NO TOCAR NINGUNA DE LAS DOS.
        //
        // El service worker responde a CUALQUIER navegación con el index.html
        // guardado, que es justo lo que hace que la app abra sin conexión. El
        // problema es que también lo haría con las direcciones que no son
        // pantallas de la app, y entonces el navegador nunca llega al
        // servidor. Aquí se listan esas excepciones:
        //
        //  /__/auth/  el ayudante de login de Google, servido desde nuestro
        //             propio dominio (ver src/lib/firebase.ts). Sin esta
        //             línea, el ingreso se rompe para todo el mundo.
        //
        //  /api/      el servidor MCP y su OAuth. Sin esta línea, al tocar
        //             "Conectar" en Claude el navegador se queda en
        //             /api/oauth/authorize con el index.html cacheado encima
        //             y la app pinta "Página no encontrada": el 302 hacia
        //             /autorizar nunca se llega a pedir.
        navigateFallbackDenylist: [/^\/__\//, /^\/api\//],
      },
      // El SW no se registra en desarrollo para evitar cachés molestas.
      devOptions: { enabled: false },
    }),
  ],
  build: {
    // Separa librerías grandes en su propio archivo para mejorar el cacheo
    // entre despliegues (Firebase y React casi no cambian).
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: [
            'firebase/app',
            'firebase/auth',
            'firebase/firestore',
          ],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
