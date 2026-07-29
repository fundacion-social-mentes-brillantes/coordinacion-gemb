import {
  createContext,
  useCallback,
  useContext,
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

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

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5.5rem)' }}
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
