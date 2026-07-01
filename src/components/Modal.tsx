import { useEffect, type ReactNode } from 'react';
import { XIcon } from './Icons';

/** Modal responsivo: hoja inferior en móvil, centrado en escritorio. */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="card relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-b-none sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-primary-100 bg-white px-5 py-3">
          <h2 className="text-base font-semibold text-primary-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost px-2 py-1"
            aria-label="Cerrar"
          >
            <XIcon className="text-xl" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
