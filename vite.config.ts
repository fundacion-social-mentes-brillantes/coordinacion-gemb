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
        // NO TOCAR: el ayudante de login de Google vive en /__/auth/ y ahora
        // se sirve desde NUESTRO propio dominio (ver src/lib/firebase.ts). Si
        // se quita esta línea, el service worker le responde con el index.html
        // de la app y el ingreso se rompe para todo el mundo.
        navigateFallbackDenylist: [/^\/__\/auth\//],
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
