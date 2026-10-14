import { COORDINATOR_NAMES } from '../lib/constants';

/**
 * Selector de quién coordina: atajos con las coordinadoras habituales y un
 * campo libre para cualquier otro nombre. Tocar un nombre otra vez lo quita.
 *
 * `nombres` es el equipo guardado en el Calendario; sin él, la lista fija.
 */
export function CoordinatorPicker({
  value,
  onChange,
  nombres = COORDINATOR_NAMES,
  conLibre = true,
}: {
  value: string;
  onChange: (v: string) => void;
  nombres?: string[];
  /** Mostrar el campo para escribir otro nombre. */
  conLibre?: boolean;
}) {
  const isPreset = nombres.includes(value);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {nombres.map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected ? '' : n)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 px-4 text-[15px] font-medium transition active:scale-[.98] ${
                selected
                  ? 'border-primary-500 bg-primary-500 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              {selected && <span aria-hidden>✓</span>}
              {n}
            </button>
          );
        })}
      </div>
      {conLibre && (
        <input
          className="input"
          placeholder="Otro nombre…"
          value={isPreset ? '' : value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
