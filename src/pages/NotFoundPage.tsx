import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { isUpdateReady } from '../lib/swUpdate';

export function NotFoundPage() {
  /**
   * Si hay versión nueva esperando, se aplica sola (una vez).
   *
   * Aquí es donde acaba quien tiene la app vieja guardada en el teléfono y
   * abre una dirección que la versión vieja no conoce todavía. Pasó de
   * verdad: con el service worker antiguo, tocar "Conectar" en Claude
   * terminaba en esta pantalla, y desde aquí no había forma de salir —el
   * aviso de "Actualizar" vive en la barra de dentro de la app, y la
   * actualización automática, en la pantalla de ingreso; a ninguna de las
   * dos se llega desde aquí—.
   *
   * Nadie está en mitad de una reunión en una pantalla de error, así que
   * actualizar sin preguntar es lo correcto. Una sola vez, para no ciclar.
   */
  useEffect(() => {
    const YA = 'gemb:auto-actualizado-404';
    const apply = () => {
      try {
        if (sessionStorage.getItem(YA)) return;
        sessionStorage.setItem(YA, '1');
      } catch {
        /* sin almacenamiento: se actualiza igual */
      }
      window.dispatchEvent(new CustomEvent('gemb:do-update'));
    };
    if (isUpdateReady()) apply();
    window.addEventListener('gemb:update-ready', apply);
    return () => window.removeEventListener('gemb:update-ready', apply);
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-surface px-6 text-center">
      <Logo className="h-16 w-16" />
      <h1 className="mt-6 text-2xl font-bold text-primary-800">
        Página no encontrada
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        La dirección que buscas no existe.
      </p>
      <Link to="/sesiones" className="btn-primary mt-6">
        Ir al inicio
      </Link>
    </div>
  );
}
