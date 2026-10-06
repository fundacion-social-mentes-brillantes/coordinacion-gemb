/**
 * "Instalar app" (Android/Chrome).
 *
 * El navegador lanza `beforeinstallprompt` UNA sola vez por carga, muy pronto.
 * Antes cada botón lo escuchaba por su cuenta: solo lo atrapaba el que
 * estuviera en pantalla en ese instante, y al cambiar de pantalla el botón
 * desaparecía para siempre (en Ajustes casi nunca salía). Aquí se atrapa una
 * vez, al arrancar (main.tsx importa este módulo), y se comparte.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let evento: BeforeInstallPromptEvent | null = null;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    evento = e as BeforeInstallPromptEvent;
    avisar();
  });
  window.addEventListener('appinstalled', () => {
    evento = null;
    avisar();
  });
}

export function suscribirInstalar(f: () => void) {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

export const eventoInstalar = () => evento;

let enCurso = false;

/** Abre el diálogo de instalar. Un segundo toque mientras está abierto no hace nada. */
export async function instalar(): Promise<void> {
  if (!evento || enCurso) return;
  enCurso = true;
  const e = evento;
  try {
    await e.prompt();
    await e.userChoice;
  } catch (err) {
    console.warn('No se pudo abrir la instalación', err);
  } finally {
    // El evento sirve una sola vez, se acepte o no.
    evento = null;
    enCurso = false;
    avisar();
  }
}
