import { useState } from 'react';
import { useToast } from '../context/ToastContext';
import {
  ajustesDeAvisos,
  ajustesDeBurbujas,
  androidEnNavegador,
  enAppAndroid,
  ErrorNativo,
  mostrarBurbuja,
  type EstadoBurbuja,
} from '../lib/nativo';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { AndroidIcon, BurbujaIcon, XIcon } from './Icons';

// ---------------------------------------------------------------------------
//  La burbuja flotante (solo en la app de Android): la reunión de hoy encima
//  de Meet o de WhatsApp, para marcar asistencia y copiar enlaces sin salir
//  de la reunión. Lo pidió la coordinación.
// ---------------------------------------------------------------------------

/**
 * La app de Android se reparte por Google Play (prueba interna: solo las
 * cuentas del equipo que estén en la lista de Play Console). Un solo canal:
 * el APK de GitHub está firmado con otra llave y no se podría actualizar
 * desde Play sin desinstalar.
 */
export const URL_APP_ANDROID = 'https://play.google.com/apps/internaltest/4701459342913607202';

const NO_OFRECER_APP = 'gemb:no-ofrecer-app-android';

/** Se ofrece bajar la app solo cuando ya hay una versión publicada y probada. */
const APP_PUBLICADA = true;

/** En la app: el botón para sacar la burbuja. En Android con Chrome: bajar la app. */
export function BotonBurbuja() {
  const { toast } = useToast();
  const [ocupado, setOcupado] = useState(false);
  const [ayuda, setAyuda] = useState<EstadoBurbuja | 'sin-permiso' | null>(null);

  if (!enAppAndroid) return androidEnNavegador && APP_PUBLICADA ? <OfrecerApp /> : null;

  const activar = async () => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const e = await mostrarBurbuja();
      if (e.flotando) toast('Listo: la burbuja quedó flotando. Ábrela encima de Meet.', 'success');
      else setAyuda(e);
    } catch (err) {
      if (err instanceof ErrorNativo && err.codigo === 'sin-permiso') setAyuda('sin-permiso');
      else toast('No se pudo mostrar la burbuja.', 'error');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="card flex items-center gap-3 p-4">
      <span className="icono-burbuja" aria-hidden>
        <BurbujaIcon />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900">Burbuja flotante</p>
        <p className="text-xs leading-snug text-slate-500">
          La asistencia, la carpeta y los enlaces, encima de Meet.
        </p>
      </div>
      <button
        type="button"
        onClick={activar}
        disabled={ocupado}
        className="btn-primary min-h-[44px] shrink-0 whitespace-nowrap px-4 text-sm"
      >
        {ocupado ? <Spinner className="h-4 w-4" /> : 'Activar'}
      </button>
      {ayuda && <AyudaBurbuja estado={ayuda} onClose={() => setAyuda(null)} />}
    </section>
  );
}

/** Cuando Android no mostró la burbuja: qué hacer, con el botón a los ajustes. */
function AyudaBurbuja({
  estado,
  onClose,
}: {
  estado: EstadoBurbuja | 'sin-permiso';
  onClose: () => void;
}) {
  const e = typeof estado === 'object' ? estado : null;
  const sinPermiso = !e || !e.avisos;
  const canalApagado = !sinPermiso && !!e?.canalApagado;
  const sinBurbujas = !sinPermiso && !canalApagado && !!e && !e.soportada;
  const apagadasEnTodo = !sinPermiso && !canalApagado && !sinBurbujas && e?.general === false;
  const titulo = sinPermiso
    ? 'Falta un permiso'
    : canalApagado
      ? 'El aviso de la reunión está apagado'
      : sinBurbujas
        ? 'Este teléfono no muestra burbujas'
        : '¿No ves la burbuja?';

  return (
    <Modal open onClose={onClose} title={titulo}>
      <div className="space-y-3 text-[15px] leading-relaxed text-slate-700">
        {canalApagado ? (
          <>
            <p>
              En los ajustes de avisos de la app está apagada la categoría{' '}
              <strong>«Burbuja de la reunión»</strong>. Enciéndela y vuelve a tocar{' '}
              <strong>«Activar»</strong>.
            </p>
            <button type="button" className="btn-primary w-full" onClick={() => void ajustesDeAvisos()}>
              Abrir los ajustes de avisos
            </button>
          </>
        ) : sinPermiso ? (
          <>
            <p>
              La burbuja es un aviso de la app, y los avisos están apagados. Actívalos y vuelve
              a tocar <strong>«Activar»</strong>.
            </p>
            <button type="button" className="btn-primary w-full" onClick={() => void ajustesDeAvisos()}>
              Abrir los ajustes de avisos
            </button>
          </>
        ) : sinBurbujas ? (
          <p>
            Este teléfono no tiene burbujas (son de Android 11 en adelante, y los teléfonos
            «Android Go» no las muestran). Te dejé un <strong>aviso fijo</strong>: baja la barra
            de arriba y toca <strong>«Reunión de hoy»</strong> para abrir la reunión.
          </p>
        ) : (
          <>
            {apagadasEnTodo ? (
              <p>
                Las burbujas están <strong>apagadas en todo el teléfono</strong>. Primero
                enciéndelas en Ajustes → Notificaciones → <strong>Burbujas</strong> (en Samsung:
                Ajustes → Notificaciones → Ajustes avanzados → Notificaciones flotantes →{' '}
                <strong>Burbujas</strong>). Después:
              </p>
            ) : (
              <p>Android pide permiso la primera vez. Hazlo una sola vez:</p>
            )}
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                Toca <strong>«Abrir ajustes de burbujas»</strong> y elige{' '}
                <strong>«Todas las conversaciones pueden mostrarse como burbujas»</strong>.
              </li>
              <li>
                Vuelve aquí y toca <strong>«Activar»</strong> otra vez.
              </li>
            </ol>
            <button type="button" className="btn-primary w-full" onClick={() => void ajustesDeBurbujas()}>
              Abrir ajustes de burbujas
            </button>
            {!apagadasEnTodo && (
              <p className="rounded-2xl bg-slate-100 px-3 py-2.5 text-sm text-slate-600">
                <strong>En Samsung:</strong> Ajustes → Notificaciones → Ajustes avanzados →
                Notificaciones flotantes → <strong>Burbujas</strong>.
              </p>
            )}
            <p className="text-sm text-slate-500">
              Si aun así no flota, baja la barra de avisos y toca «Reunión de hoy»: abre lo mismo
              en pantalla completa.
            </p>
          </>
        )}
        <button type="button" className="btn-secondary w-full" onClick={onClose}>
          Entendido
        </button>
      </div>
    </Modal>
  );
}

/** Android en el navegador: la burbuja solo existe en la app. Se puede descartar. */
function OfrecerApp() {
  const [oculto, setOculto] = useState(() => {
    try {
      return localStorage.getItem(NO_OFRECER_APP) === '1';
    } catch {
      return false;
    }
  });
  if (oculto) return null;

  const descartar = () => {
    try {
      localStorage.setItem(NO_OFRECER_APP, '1');
    } catch {
      /* sin almacenamiento: se oculta solo por ahora */
    }
    setOculto(true);
  };

  return (
    <section className="card relative p-4 pr-12">
      <button
        type="button"
        onClick={descartar}
        className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-slate-400"
        aria-label="No volver a mostrar"
      >
        <XIcon className="text-lg" />
      </button>
      <div className="flex items-center gap-3">
        <span className="icono-burbuja" aria-hidden>
          <AndroidIcon />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">App de Android</p>
          <p className="text-xs leading-snug text-slate-500">
            Con burbuja flotante encima de Meet, para la asistencia y los enlaces.
          </p>
        </div>
      </div>
      <a href={URL_APP_ANDROID} className="btn-secondary mt-3 min-h-[44px] w-full text-sm">
        Instalar desde Google Play
      </a>
      <p className="mt-2 text-xs leading-snug text-slate-500">
        Toca «Aceptar invitación» y después «Descargar en Google Play». Funciona con la cuenta de
        Google con la que entras aquí.
      </p>
    </section>
  );
}
