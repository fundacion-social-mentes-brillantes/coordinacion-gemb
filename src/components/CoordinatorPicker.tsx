import { COORDINATOR_NAMES } from '../lib/constants';

/**
 * Selector de quién coordina: atajos con las coordinadoras habituales y un
 * campo libre para cualquier otro nombre. Tocar un nombre otra vez lo quita.
 */
export function CoordinatorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const isPreset = COORDINATOR_NAMES.includes(value);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {COORDINATOR_NAMES.map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(selected ? '' : n)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                selected
                  ? 'border-primary-500 bg-primary-50 text-primary-800'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <input
        className="input"
        placeholder="Otro nombre…"
        value={isPreset ? '' : value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
