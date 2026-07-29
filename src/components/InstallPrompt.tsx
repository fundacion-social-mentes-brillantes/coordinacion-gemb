import { useEffect, useState } from 'react';
import { InstallIcon } from './Icons';

// Captura el evento `beforeinstallprompt` (Android/Chrome) para ofrecer
// "Instalar app". En iPhone se instala desde Safari (Compartir → Añadir a
// pantalla de inicio); ahí este botón no aparece (el navegador no lo soporta).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallButton({ className }: { className?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const installed = () => setDeferred(null);
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if (!deferred) return null;

  return (
    <button
      type="button"
      className={className ?? 'btn-secondary text-sm'}
      onClick={async () => {
        await deferred.prompt();
        await deferred.userChoice;
        setDeferred(null);
      }}
    >
      <InstallIcon className="text-lg" />
      Instalar app
    </button>
  );
}

/**
 * En el iPhone no existe el evento de instalación: hay que explicarle a la
 * persona los dos toques de Safari. Solo se muestra en iPhone/iPad y cuando
 * la app todavía NO está instalada.
 */
export function IosInstallHelp({ className }: { className?: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const isIOS =
      /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const installed =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setShow(isIOS && !installed);
  }, []);

  if (!show) return null;

  return (
    <div
      className={
        className ??
        'rounded-2xl bg-primary-50 px-4 py-3 text-left text-sm text-primary-800'
      }
    >
      <p className="font-semibold">📲 Para tenerla como app en tu iPhone</p>
      <p className="mt-1">
        Toca el botón <strong>Compartir</strong> (el cuadrito con la flecha ↑,
        abajo en Safari) y luego <strong>«Agregar a inicio»</strong>.
      </p>
    </div>
  );
}
