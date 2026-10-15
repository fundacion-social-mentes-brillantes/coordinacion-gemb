import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from './Icons';

/* ------------------------------------------------------------------ */
/* Botón atrás del celular                                             */
/* ------------------------------------------------------------------ */
// Cada modal abierto deja una entrada en el historial: así el botón atrás de
// Android (o deslizar atrás en el iPhone) cierra el modal, en vez de sacar a
// la coordinadora de la reunión y perder lo que estaba escribiendo.
//
// Al cerrar el modal con la X, el fondo o "Guardar", esa entrada se quita con
// history.back(). Ese "atrás" lo provoca la app, no la persona: hay que
// reconocerlo para no cerrar por error OTRO modal que se acabe de abrir. Este
// oyente se registra primero (al cargar el módulo), así que marca cada evento
// antes de que lo vean los modales.
let atrasPropios = 0;
let atrasActualEsPropio = false;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    atrasActualEsPropio = atrasPropios > 0;
    if (atrasPropios > 0) atrasPropios--;
  });
}

/**
 * Modal responsivo: hoja inferior en móvil, centrado en escritorio.
 *
 * Detalles pensados para el celular:
 * - bloquea el desplazamiento del fondo mientras está abierto (si no, al
 *   deslizar dentro del modal se movía la página de atrás);
 * - respeta la barra de gestos del iPhone (safe-area);
 * - tiene una "agarradera" arriba para que se entienda que es una hoja;
 * - el botón de cerrar mide 44px, el mínimo cómodo para el dedo.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  completa = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Ocupa toda la pantalla en el celular (para leer la carpeta). */
  completa?: boolean;
}) {
  // Alto del teclado en pantalla: en el iPhone tapaba el botón de guardar.
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) return;
    const sync = () =>
      setKeyboard(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      setKeyboard(0);
    };
  }, [open]);

  // Cerrar con Escape. Va aparte del bloqueo del fondo porque `onClose` suele
  // ser una función nueva en cada render y volvería a ejecutar el efecto.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Botón atrás = cerrar el modal (ver arriba). El `setTimeout` evita que, en
  // desarrollo, React (que monta los efectos dos veces) deje dos entradas.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const id = `${Date.now()}-${Math.random()}`;
    let empujado = false;
    let cerradoConAtras = false;
    const onPop = () => {
      if (atrasActualEsPropio) return;
      cerradoConAtras = true;
      onCloseRef.current();
    };
    const t = setTimeout(() => {
      // Se conserva el estado del enrutador (React Router lo usa).
      const prev = (window.history.state ?? {}) as Record<string, unknown>;
      window.history.pushState({ ...prev, gembModal: id }, '');
      empujado = true;
      window.addEventListener('popstate', onPop);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('popstate', onPop);
      const estado = window.history.state as { gembModal?: string } | null;
      if (empujado && !cerradoConAtras && estado?.gembModal === id) {
        atrasPropios++;
        window.history.back();
      }
    };
  }, [open]);

  // Congela el fondo sin perder la posición del scroll. Depende SOLO de
  // `open`: si se repitiera en cada tecleo, guardaría una posición de scroll
  // equivocada y al cerrar la página saltaría al principio.
  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    const ruta = window.location.pathname;
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      // Volver a la posición de antes solo si seguimos en la misma pantalla:
      // si el modal se cerró al navegar (p. ej. "Abrir esa sesión"), la nueva
      // pantalla debe empezar arriba.
      if (window.location.pathname === ruta) window.scrollTo(0, scrollY);
    };
  }, [open]);

  if (!open) return null;

  // Se dibuja directo en <body>: si quedara dentro de una tarjeta de vidrio
  // o de la animación de entrada, esas cajas la encierran y la barra de
  // abajo le tapa el botón de guardar.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* La hoja, como las de iOS: vidrio casi opaco (para leer bien) con
          esquinas grandes y el reflejo de luz en el filo. */}
      <div
        className={`hoja vidrio-barra relative w-full overflow-y-auto overscroll-contain ${
          completa
            ? 'h-[100dvh] max-w-3xl rounded-none sm:h-[94dvh] sm:rounded-[30px]'
            : 'max-w-md rounded-t-[30px] sm:rounded-[30px]'
        }`}
        style={{
          // Se levanta lo justo para que el teclado no tape los botones.
          marginBottom: keyboard ? `${keyboard}px` : undefined,
          maxHeight: completa ? undefined : `calc(90dvh - ${keyboard}px)`,
        }}
      >
        <div className={`hoja-cabecera sticky top-0 z-10 ${completa ? 'safe-top' : ''}`}>
          {/* Agarradera (solo móvil): deja claro que es una hoja deslizable */}
          <div className={`pt-2 sm:hidden ${completa ? '!hidden' : ''}`}>
            <div className="mx-auto h-[5px] w-9 rounded-full bg-[rgba(255,255,255,0.3)]" />
          </div>
          <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-2.5">
            <h2 className="min-w-0 flex-1 truncate text-[19px] font-bold text-slate-900">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="boton-redondo -mr-1 h-[34px] w-[34px] text-slate-500"
              aria-label="Cerrar"
            >
              <XIcon className="text-lg" />
            </button>
          </div>
        </div>
        <div
          className="px-5 pb-5 pt-2"
          style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
