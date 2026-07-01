// Logo PLACEHOLDER de la fundación. El diseño real se agregará después.
// Para reemplazarlo: edita este componente y/o el archivo public/logo.svg
// (ver README → "Reemplazar el logo y los iconos").
export function Logo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 128 128"
      className={className}
      role="img"
      aria-label="Logo GEMB"
    >
      <defs>
        <linearGradient id="logoG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2b9678" />
          <stop offset="1" stopColor="#1f7862" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="28" fill="url(#logoG)" />
      <circle cx="64" cy="64" r="34" fill="none" stroke="#f2faf7" strokeWidth={9} />
      <circle cx="64" cy="64" r="13" fill="#f2faf7" />
    </svg>
  );
}
