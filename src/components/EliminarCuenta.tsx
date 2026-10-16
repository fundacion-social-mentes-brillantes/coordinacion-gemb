import { useCallback, useEffect, useState } from 'react';
import { MARCA_ELIMINAR, useAuth, type ResultadoEliminar } from '../context/AuthContext';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

/** La marca de "volví a entrar para borrar mi cuenta" sirve 15 minutos. */
function marcaReciente(): boolean {
  try {
    const v = localStorage.getItem(MARCA_ELIMINAR);
    return !!v && Date.now() - Number(v) < 15 * 60_000;
  } catch {
    return false;
  }
}

function quitarMarca() {
  try {
    localStorage.removeItem(MARCA_ELIMINAR);
  } catch {
    /* nada */
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function ponerMarcaEliminar() {
  try {
    localStorage.setItem(MARCA_ELIMINAR, String(Date.now()));
  } catch {
    /* modo privado: tocará volver a Ajustes a mano */
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export { marcaReciente as hayMarcaEliminar };

type Estado = 'pregunta' | 'borrando' | Exclude<ResultadoEliminar, 'listo'> | 'error';

/**
 * «Eliminar mi cuenta»: lo exige Google Play a toda app con cuentas. Borra el
 * perfil y el acceso; las asistencias y el calendario quedan como registro de
 * la fundación (así lo dice la política de privacidad).
 *
 * Si Google pide haber entrado hace poco, se sale, se vuelve a entrar y la
 * app trae de vuelta a esta confirmación sola (ver `MARCA_ELIMINAR`).
 */
export function EliminarCuenta({ className = '' }: { className?: string }) {
  const { eliminarCuenta, logout, isSuperAdmin, user } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const [estado, setEstado] = useState<Estado>('pregunta');

  // Volvió de entrar otra vez para terminar de borrar: se abre solo.
  useEffect(() => {
    if (user && marcaReciente()) {
      setEstado('pregunta');
      setAbierto(true);
    }
  }, [user]);

  const cerrar = useCallback(() => {
    if (estado === 'borrando') return;
    quitarMarca();
    setAbierto(false);
    setEstado('pregunta');
  }, [estado]);

  const borrar = async () => {
    setEstado('borrando');
    try {
      const r = await eliminarCuenta();
      if (r !== 'listo') setEstado(r);
    } catch (e) {
      console.error('No se pudo eliminar la cuenta', e);
      setEstado('error');
    }
  };

  const volverAEntrar = async () => {
    ponerMarcaEliminar();
    if (!(await logout())) quitarMarca();
  };

  if (!user || isSuperAdmin) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={`btn-ghost min-h-[44px] w-full text-sm text-rose-600 ${className}`}
      >
        Eliminar mi cuenta
      </button>

      <Modal open={abierto} onClose={cerrar} title="Eliminar mi cuenta">
        {(estado === 'pregunta' || estado === 'borrando' || estado === 'error') && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-600">
              Se borran tu acceso a Coordinación y los datos de tu cuenta: tu nombre, tu correo
              y tu foto de Google. No se puede deshacer.
            </p>
            <p className="text-sm leading-relaxed text-slate-600">
              Las asistencias que tomaste y el calendario siguen siendo registros de la fundación.
              Si algún día vuelves, entras con Google y la coordinación te da acceso otra vez.
            </p>
            {estado === 'error' && (
              <p className="rounded-2xl border border-rose-300/40 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                No se pudo eliminar. Inténtalo de nuevo en un momento.
              </p>
            )}
            <button
              type="button"
              onClick={borrar}
              disabled={estado === 'borrando'}
              className="btn-danger min-h-[48px] w-full"
            >
              {estado === 'borrando' ? <Spinner className="h-5 w-5" /> : 'Sí, eliminar mi cuenta'}
            </button>
            <button
              type="button"
              onClick={cerrar}
              disabled={estado === 'borrando'}
              className="btn-ghost min-h-[44px] w-full text-sm"
            >
              Cancelar
            </button>
          </div>
        )}

        {estado === 'entra-de-nuevo' && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-600">
              Por seguridad, Google solo deja eliminar una cuenta si entraste hace muy poco.
            </p>
            <p className="text-sm leading-relaxed text-slate-600">
              Toca <strong>Volver a entrar</strong>, entra otra vez con Google y la app te trae de
              vuelta aquí para terminar.
            </p>
            <button type="button" onClick={volverAEntrar} className="btn-primary min-h-[48px] w-full">
              Volver a entrar
            </button>
            <button type="button" onClick={cerrar} className="btn-ghost min-h-[44px] w-full text-sm">
              Cancelar
            </button>
          </div>
        )}

        {estado === 'sin-senal' && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-600">
              No hay conexión, así que no se borró nada. Inténtalo cuando tengas señal.
            </p>
            <button type="button" onClick={cerrar} className="btn-secondary min-h-[48px] w-full">
              Entendido
            </button>
          </div>
        )}

        {estado === 'principal' && (
          <p className="text-sm leading-relaxed text-slate-600">
            La cuenta principal no se puede eliminar desde la app.
          </p>
        )}
      </Modal>
    </>
  );
}
