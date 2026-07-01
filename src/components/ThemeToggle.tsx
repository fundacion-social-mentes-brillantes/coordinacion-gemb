import { useTheme, type Theme } from '../context/ThemeContext';

const OPTIONS: { key: Theme; label: string; color: string }[] = [
  { key: 'light', label: 'Verde', color: '#2b9678' },
  { key: 'pink', label: 'Rosa', color: '#c83ab8' },
  { key: 'dark', label: 'Dorado', color: '#d7b46a' },
];

/** Selector de tema: tres círculos de color (Verde / Rosa / Dorado). */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      className={`flex items-center gap-1.5 ${className}`}
      role="group"
      aria-label="Tema de color"
    >
      {OPTIONS.map((o) => {
        const active = theme === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => setTheme(o.key)}
            aria-label={`Tema ${o.label}`}
            aria-pressed={active}
            title={o.label}
            className="h-6 w-6 rounded-full transition"
            style={{
              background: o.color,
              transform: active ? 'scale(1.08)' : 'none',
              boxShadow: active
                ? '0 0 0 2px var(--app-bg-ring, var(--app-panel-solid)), 0 0 0 4px var(--app-accent)'
                : 'inset 0 0 0 1px rgba(0,0,0,0.18)',
            }}
          />
        );
      })}
    </div>
  );
}
