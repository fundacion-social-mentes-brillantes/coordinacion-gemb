import { useEffect, useState, useSyncExternalStore } from 'react';
import { InstallIcon } from './Icons';
import { authIsFirstParty } from '../lib/firebase';
import { isAppleMobile, isStandalone } from '../lib/device';
import { eventoInstalar, instalar, suscribirInstalar } from '../lib/instalar';

// "Instalar app" en Android/Chrome. En iPhone se instala desde Safari
// (Compartir → Añadir a pantalla de inicio); ahí este botón no aparece.

/**
 * ¿El navegador ofrece instalar la app? (Android/Chrome.)
 *
 * Se saca a un hook para que quien pinte un apartado con título pueda saber
 * ANTES si va a haber algo debajo. Si no, queda un rótulo huérfano encima de
 * la nada, que es lo que pasaba en Ajustes.
 */
export function usePuedeInstalar() {
  const evento = useSyncExternalStore(suscribirInstalar, eventoInstalar, () => null);
  return [evento] as const;
}

/**
 * ¿Hay que explicar los dos toques de Safari? (iPhone/iPad sin instalar.)
 *
 * Mientras el ayudante de Google siga en el dominio de Firebase, la app
 * instalada del iPhone NO puede entrar (ver `signIn` en AuthContext), y la
 * sesión de Safari no pasa a la app instalada: son almacenes separados. Invitar
 * a instalar sería mandar a la persona a un callejón sin salida, así que la
 * ayuda se esconde hasta que el ingreso funcione ahí.
 */
export function useNecesitaAyudaIos() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(isAppleMobile() && !isStandalone() && authIsFirstParty);
  }, []);

  return show;
}

export function InstallButton({ className }: { className?: string }) {
  const [evento] = usePuedeInstalar();

  if (!evento) return null;

  return (
    <button
      type="button"
      className={className ?? 'btn-secondary text-sm'}
      onClick={() => void instalar()}
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
  const show = useNecesitaAyudaIos();

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
