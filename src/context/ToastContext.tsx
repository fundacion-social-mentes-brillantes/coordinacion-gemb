import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}
interface ToastCtx {
  toast: (message: string, type?: ToastType) => void;
}

const Ctx = createContext<ToastCtx>({ toast: () => {} });
// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(Ctx);

let counter = 0;

// Colores fijos (legibles en cualquier tema): los toasts no cambian con el modo.
const STYLES: Record<ToastType, string> = {
  success: 'linear-gradient(135deg, #16a34a, #15803d)',
  error: '#dc2626',
  info: '#1f2937',
};

/**
 * Alto del teclado en pantalla. En el iPhone (y Chrome Android reciente) el
 * teclado tapa la parte de abajo sin achicar la página: los avisos, que van
 * abajo, quedaban detrás de él y un error ("No se pudo agregar…") no se veía.
 */
function useAltoTeclado() {
  const [alto, setAlto] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => setAlto(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);
  return alto;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const teclado = useAltoTeclado();

  const dismiss = useCallback(
    (id: number) => setItems((s) => s.filter((t) => t.id !== id)),
    [],
  );

  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = ++counter;
      // Máximo 3 avisos a la vez: en una reunión se marca muy seguido.
      setItems((s) => [...s.slice(-2), { id, message, type }]);
      // Los errores se quedan más tiempo para alcanzar a leerlos.
      setTimeout(() => dismiss(id), type === 'error' ? 5000 : 2600);
    },
    [dismiss],
  );

  // Mismo objeto mientras `toast` no cambie: si no, cada aviso hacía volver a
  // pintar todas las pantallas que usan avisos.
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
        style={{
          bottom: teclado > 0
            ? `${teclado + 12}px`
            : 'calc(env(safe-area-inset-bottom) + 5.5rem)',
        }}
      >
        {items.map((t) => (
          <button
            key={t.id}
            type="button"
            role="status"
            onClick={() => dismiss(t.id)}
            className="pointer-events-auto max-w-sm rounded-xl px-4 py-3 text-left text-sm font-medium shadow-lifted"
            style={{ background: STYLES[t.type], color: '#ffffff' }}
          >
            {t.message}
          </button>
        ))}
      </div>
    </Ctx.Provider>
  );
}
