/** Círculo que gira, en el color del acento. */
export function Spinner({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg
      // Con un color propio (p. ej. blanco dentro de un botón azul) se usa ese.
      className={`animate-spin ${className.includes('text-') ? '' : 'text-primary-500'} ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Cargando"
    >
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-95"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        d="M12 2a10 10 0 0 1 10 10"
      />
    </svg>
  );
}

/**
 * La pantalla de carga: el ícono con una luz azul que gira alrededor y
 * "Coordinación · GEMB" en blanco y azul. Es la misma que se ve al abrir la app
 * (index.html), así el arranque no salta de un dibujo a otro.
 */
export function FullScreenSpinner({ label }: { label?: string }) {
  return (
    <div className="arranque" role="status" aria-label={label ?? 'Cargando'}>
      <div className="arranque-icono">
        <span className="arranque-orbita" />
        <img src="/pwa-192x192.png" alt="" width={84} height={84} />
      </div>
      <p className="marca-titulo">Coordinación</p>
      <p className="marca-gemb">GEMB</p>
      {label && <p className="mt-3 text-sm text-slate-500">{label}</p>}
    </div>
  );
}
