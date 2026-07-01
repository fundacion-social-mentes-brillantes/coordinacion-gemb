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
