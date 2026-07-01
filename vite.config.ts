import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Configuración de Vite + React + PWA.
// La PWA usa `autoUpdate`: el service worker se actualiza solo cuando hay
// una versión nueva desplegada, sin molestar a la usuaria.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'logo.svg'],
      manifest: {
        name: 'Asistencia GEMB',
        short_name: 'GEMB',
        description:
          'Control de asistencia — Gimnasio Emocional Mentes Brillantes',
        lang: 'es',
        dir: 'ltr',
        theme_color: '#2b9678',
        background_color: '#f2faf7',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
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
        // No interceptar el handler de autenticación de Firebase.
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
