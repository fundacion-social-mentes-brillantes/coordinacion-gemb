/** El ícono de Coordinación (el mismo de la app instalada). */
export function Logo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <img
      src="/pwa-192x192.png"
      className={`${className} shrink-0 rounded-[28%] object-cover shadow-[0_8px_22px_-10px_rgba(47,107,255,0.8)]`}
      alt="Coordinación GEMB"
      draggable={false}
    />
  );
}

/** "Coordinación" en oro con "GEMB" espaciado debajo, como Kits y Budget. */
export function Marca({ tamano = 'md' }: { tamano?: 'sm' | 'md' | 'lg' }) {
  const t = { sm: ['text-xl', 'text-[0.5rem]'], md: ['text-3xl', 'text-[0.6rem]'], lg: ['text-[2.6rem]', 'text-[0.7rem]'] }[
    tamano
  ];
  return (
    <div className="flex flex-col items-center gap-2">
      <span className={`marca-titulo ${t[0]}`}>Coordinación</span>
      <span className={`marca-gemb ${t[1]}`}>GEMB</span>
    </div>
  );
}
