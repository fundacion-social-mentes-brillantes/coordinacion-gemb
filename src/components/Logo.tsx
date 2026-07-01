export function Logo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      className={`${className} shrink-0 object-contain`}
      alt="Logo GEMB"
      draggable={false}
    />
  );
}
