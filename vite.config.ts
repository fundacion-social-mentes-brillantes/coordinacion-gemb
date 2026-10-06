import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Configuración de Vite + React + PWA.
// La PWA usa `prompt`: cuando hay versión nueva se AVISA con un botón, en vez
// de recargarse en la cara de nadie (en plena reunión perdería el hilo). Se
// instala sola solo cuando no estorba: al abrir, o tras un minuto en segundo
// plano (ver main.tsx).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'logo.svg'],
      manifest: {
        name: 'Coordinación GEMB',
        short_name: 'Coordinación GEMB',
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
        // Las librerías de exportar/importar (Excel y PDF, más de 1 MB) solo
        // las usa la administración: no se descargan de antemano en el
        // celular de cada coordinadora. Se bajan la primera vez que se usan y
        // desde ahí quedan guardadas (ver runtimeCaching).
        globIgnores: [
          '**/xlsx-*.js',
          '**/pdf-*.js',
          '**/html2canvas*.js',
          '**/purify*.js',
          '**/index.es-*.js',
        ],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(xlsx|pdf|html2canvas|purify|index\.es)[-.][^/]*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gemb-librerias-admin',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 60 },
            },
          },
        ],
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
          // Con nombre propio para poder dejarlas fuera de la descarga
          // anticipada (globIgnores, arriba).
          xlsx: ['xlsx'],
          pdf: ['jspdf', 'jspdf-autotable'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
