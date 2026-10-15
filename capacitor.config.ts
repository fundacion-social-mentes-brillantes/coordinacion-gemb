import type { CapacitorConfig } from '@capacitor/cli';

// La app de Android: la misma Coordinación GEMB dentro de una app nativa, para
// poder tener la burbuja flotante encima de Meet (en iPhone sigue siendo la
// app instalada desde el navegador).
//
// Carga la página publicada (server.url): así cada cambio de la app llega
// solo, sin reinstalar. Lo único que necesita una versión nueva del APK es la
// parte nativa (la burbuja y el inicio de sesión con Google).
const config: CapacitorConfig = {
  appId: 'com.gimnasioemocionalmb.coordinacion',
  appName: 'Coordinación GEMB',
  webDir: 'dist',
  server: {
    url: 'https://coordinacion-gemb.vercel.app',
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#03050f',
    // Para que la página sepa que está dentro de la app aunque el puente
    // nativo (GembNativo) no estuviera (WebView muy viejo).
    appendUserAgent: 'GembAndroid',
  },
  plugins: {
    // Íconos claros en la barra de estado: el fondo de la app es oscuro.
    SystemBars: { style: 'DARK' },
  },
};

export default config;
