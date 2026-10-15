import { useEffect, useRef, useState } from 'react';
import { useApariencia } from '../context/ThemeContext';
import { TEMAS_LISTOS, normalizarFondo, normalizarLuz, type ColoresTema } from '../lib/tema';
import { CheckIcon } from './Icons';

// Los colores de la app, como en Budget: temas listos y uno propio.
// Todo se ve al instante (vista previa) y queda guardado en este aparato.

const RAPIDOS: Record<'fondo' | 'luz', Array<[string, string]>> = {
  fondo: [
    ['#050a1c', 'Azul noche'],
    ['#000000', 'Negro'],
    ['#07040f', 'Uva'],
    ['#03110c', 'Bosque'],
    ['#12050c', 'Vino'],
    ['#0f0a05', 'Café'],
    ['#041019', 'Petróleo'],
    ['#121214', 'Grafito'],
  ],
  luz: [
    ['#e2bd6a', 'Oro'],
    ['#2f6bff', 'Azul'],
    ['#8fe3ff', 'Cielo'],
    ['#19d3c5', 'Turquesa'],
    ['#22c55e', 'Verde'],
    ['#cdb4ff', 'Lila'],
    ['#8a3df0', 'Violeta'],
    ['#ffb3d9', 'Rosado'],
    ['#e0337f', 'Fucsia'],
    ['#ff7a1a', 'Naranja'],
    ['#dfe3ee', 'Plata'],
  ],
};

type Ranura = 'fondo' | 'luz1' | 'luz2';
const RANURAS: Array<{ id: Ranura; nombre: string; ayuda: string }> = [
  { id: 'fondo', nombre: 'Fondo', ayuda: 'El color de atrás. Siempre queda oscuro para que todo se lea.' },
  { id: 'luz1', nombre: 'Luz 1', ayuda: 'El acento: botones, lo seleccionado y los detalles.' },
  { id: 'luz2', nombre: 'Luz 2', ayuda: 'El resplandor del fondo.' },
];

/** Una tarjetita que muestra cómo se ve un tema. */
function Muestra({ c, activo }: { c: ColoresTema; activo: boolean }) {
  const fondo = normalizarFondo(c.fondo);
  const l1 = normalizarLuz(c.luz1);
  const l2 = normalizarLuz(c.luz2);
  return (
    <span
      className={`relative block h-16 w-full overflow-hidden rounded-2xl border ${
        activo ? 'border-primary-500' : 'border-white/10'
      }`}
      style={{
        background: `radial-gradient(120% 90% at 90% -10%, ${l2}80, transparent 60%), ${fondo}`,
      }}
    >
      <span className="absolute bottom-2 left-2 h-3 w-10 rounded-full" style={{ background: l1 }} />
      <span className="absolute bottom-2 left-14 h-3 w-6 rounded-full bg-white/25" />
      {activo && (
        <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary-500 text-white">
          <CheckIcon className="text-sm" />
        </span>
      )}
    </span>
  );
}

export function ColoresEditor() {
  const { apariencia, elegirTema, guardarPropio, vistaPrevia } = useApariencia();
  const [editando, setEditando] = useState(false);
  const [propio, setPropio] = useState<ColoresTema>(apariencia.propio);
  const [ranura, setRanura] = useState<Ranura>('luz1');

  // Mientras se edita, la app entera se ve con los colores de prueba.
  useEffect(() => {
    if (editando) vistaPrevia(propio);
  }, [editando, propio, vistaPrevia]);
  // Al salir de Ajustes sin guardar, vuelven los colores guardados (solo al
  // salir: con cada cambio de tema no hay que tocar nada).
  const restaurar = useRef(vistaPrevia);
  restaurar.current = vistaPrevia;
  useEffect(() => () => restaurar.current(null), []);

  const poner = (hex: string) => setPropio((p) => ({ ...p, [ranura]: hex }));

  return (
    <div className="card p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {TEMAS_LISTOS.map((t) => {
          const activo = apariencia.tema === t.id && !editando;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setEditando(false);
                elegirTema(t.id);
              }}
              aria-pressed={activo}
              className="text-left"
            >
              <Muestra c={t} activo={activo} />
              <span className="mt-1.5 block text-sm font-semibold text-slate-800">{t.nombre}</span>
              <span className="block text-xs text-slate-500">{t.detalle}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setEditando(true)}
          aria-pressed={apariencia.tema === 'propio' || editando}
          className="text-left"
        >
          <Muestra c={editando ? propio : apariencia.propio} activo={apariencia.tema === 'propio' || editando} />
          <span className="mt-1.5 block text-sm font-semibold text-slate-800">Tu tema</span>
          <span className="block text-xs text-slate-500">Elige tus colores</span>
        </button>
      </div>

      {editando && (
        <div className="mt-5 space-y-4 border-t border-[color:var(--app-border)] pt-4">
          <div className="grid grid-cols-3 gap-2">
            {RANURAS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRanura(r.id)}
                className={`flex min-h-[48px] items-center gap-2 rounded-2xl border px-3 text-sm font-semibold ${
                  ranura === r.id ? 'border-primary-500 bg-primary-500/10 text-primary-500' : 'border-white/10 text-slate-600'
                }`}
              >
                <span
                  className="h-5 w-5 shrink-0 rounded-full border border-white/20"
                  style={{ background: propio[r.id] }}
                />
                {r.nombre}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">{RANURAS.find((r) => r.id === ranura)?.ayuda}</p>
          <div className="flex flex-wrap gap-2">
            {RAPIDOS[ranura === 'fondo' ? 'fondo' : 'luz'].map(([hex, nombre]) => (
              <button
                key={hex}
                type="button"
                onClick={() => poner(hex)}
                aria-label={nombre}
                title={nombre}
                className={`h-10 w-10 rounded-full border-2 transition active:scale-95 ${
                  propio[ranura].toLowerCase() === hex ? 'border-white' : 'border-white/15'
                }`}
                style={{ background: hex }}
              />
            ))}
            {/* Cualquier otro color, con el selector del sistema. */}
            <label
              className="relative flex h-10 w-10 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-white/30 text-lg text-slate-500"
              title="Otro color"
            >
              +
              <input
                type="color"
                value={propio[ranura]}
                onChange={(e) => poner(e.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label="Otro color"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                guardarPropio(propio);
                setEditando(false);
              }}
              className="btn-primary min-h-[48px] flex-1"
            >
              Usar mis colores
            </button>
            <button
              type="button"
              onClick={() => {
                setEditando(false);
                setPropio(apariencia.propio);
                vistaPrevia(null);
              }}
              className="btn-ghost min-h-[48px]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
