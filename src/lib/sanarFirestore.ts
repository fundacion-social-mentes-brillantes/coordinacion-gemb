// Firestore guarda en el celular una copia de los datos (para funcionar sin
// señal). Muy de vez en cuando esa copia queda descuadrada —con varias
// pestañas a la vez, o después de una actualización— y Firestore se detiene
// con "INTERNAL ASSERTION FAILED": ninguna pantalla vuelve a cargar hasta
// recargar. Aquí se arregla solo:
//   1.º intento: recargar (casi siempre basta).
//   2.º intento (si vuelve a pasar en menos de un minuto): borrar la copia
//       del celular y recargar; los datos vuelven a bajar del servidor.
// Si aun así sigue, se deja el aviso "Algo falló · Recargar" de siempre.

const MARCA = 'gemb:firestore-trabado';

export function esFallaInterna(e: unknown): boolean {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return m.includes('INTERNAL ASSERTION FAILED');
}

let enCurso = false;

export async function sanarFirestore(): Promise<void> {
  if (enCurso) return;
  enCurso = true;
  let paso = 0;
  try {
    const previo = JSON.parse(sessionStorage.getItem(MARCA) || 'null') as { t: number; paso: number } | null;
    if (previo && Date.now() - previo.t < 60_000) paso = previo.paso;
    if (paso >= 2) return; // ya se intentó todo: queda el aviso de Recargar
    sessionStorage.setItem(MARCA, JSON.stringify({ t: Date.now(), paso: paso + 1 }));
  } catch {
    return; // sin almacenamiento no se puede evitar un bucle: mejor no tocar
  }
  if (paso === 1) {
    try {
      const [{ terminate, clearIndexedDbPersistence }, { db }] = await Promise.all([
        import('firebase/firestore'),
        import('./firebase'),
      ]);
      await terminate(db).catch(() => {});
      await clearIndexedDbPersistence(db).catch(() => {});
    } catch {
      /* se recarga igual */
    }
  }
  window.location.reload();
}

/** Escucha los errores sueltos de toda la app (se llama una vez al arrancar). */
export function vigilarFirestore() {
  window.addEventListener('error', (e) => {
    if (esFallaInterna(e.error ?? e.message)) void sanarFirestore();
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (esFallaInterna(e.reason)) void sanarFirestore();
  });
}
