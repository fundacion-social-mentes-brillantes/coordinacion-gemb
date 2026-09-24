/**
 * Preguntas sobre el dispositivo que cambian cómo se entra con Google.
 *
 * Viven juntas porque el ingreso y la ayuda para instalar tienen que dar
 * EXACTAMENTE la misma respuesta: si una cree que es iPhone y la otra no, la
 * pantalla ofrece instalar la app justo donde después no se puede entrar.
 */

/**
 * ¿Es un iPhone/iPad? En ellos TODOS los navegadores (Safari, Chrome…) son
 * Safari por dentro, con sus mismas reglas de privacidad.
 */
export function isAppleMobile(): boolean {
  const ua = navigator.userAgent || '';
  return (
    /iP(hone|ad|od)/.test(ua) ||
    // El iPad moderno se hace pasar por Mac; se delata por el táctil.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** ¿Se abrió desde el icono de la pantalla de inicio (app instalada)? */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
