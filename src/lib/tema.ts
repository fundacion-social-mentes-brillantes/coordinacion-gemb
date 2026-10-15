// ---------------------------------------------------------------------------
//  Los colores de la app (igual que en Budget, de la misma familia GEMB).
//
//  De tres colores que elige la persona —fondo, luz 1 (el acento: botones,
//  lo seleccionado) y luz 2 (el resplandor de fondo)— salen TODAS las
//  variables que usa la app. Se trabaja en OKLCH (claridad, croma, tono): así
//  "igual de claro" es igual de claro para el ojo, sea amarillo o azul.
//
//  Se protege la lectura: el fondo siempre queda oscuro, los textos se
//  aclaran hasta el contraste que pide WCAG y el acento siempre es lo bastante
//  claro para leer su letra oscura encima.
//
//  Todo lo que sale de aquí son números formateados por nosotros: un texto
//  raro guardado en el celular nunca llega tal cual al CSS.
// ---------------------------------------------------------------------------

export interface Oklch {
  l: number;
  c: number;
  h: number;
}
type Rgb = [number, number, number];

const HEX = /^#[0-9a-f]{6}$/;

/** "#AbC123" → "#abc123"; cualquier otra cosa → null. */
export function hexValido(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const v = valor.trim().toLowerCase();
  return HEX.test(v) ? v : null;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function hexARgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function rgbAHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;
}
const aLineal = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const deLineal = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055;

function linealAOklch([r, g, b]: Rgb): Oklch {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}
function oklchALineal({ l: L, c, h }: Oklch): Rgb {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const dentro = (rgb: Rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

export function hexAOklch(hex: string): Oklch {
  return linealAOklch(hexARgb(hex).map(aLineal) as Rgb);
}

/** OKLCH → hex; si el color no cabe en la pantalla, baja el croma (no la claridad ni el tono). */
export function oklchAHex(o: Oklch): string {
  const p = { l: clamp(o.l, 0, 1), c: Math.max(0, o.c), h: ((o.h % 360) + 360) % 360 };
  let rgb = oklchALineal(p);
  if (!dentro(rgb)) {
    let lo = 0;
    let hi = p.c;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (dentro(oklchALineal({ ...p, c: mid }))) lo = mid;
      else hi = mid;
    }
    rgb = oklchALineal({ ...p, c: lo });
  }
  return rgbAHex(rgb.map((v) => deLineal(clamp(v, 0, 1))) as Rgb);
}

function luminancia(hex: string): number {
  const [r, g, b] = hexARgb(hex).map(aLineal);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos colores (1 a 21). */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Sube la claridad hasta que el color tenga `minimo` de contraste con `contra`. */
function conContraste(o: Oklch, contra: string, minimo: number): string {
  let p = { ...o };
  for (let i = 0; i < 80; i += 1) {
    const hex = oklchAHex(p);
    if (contraste(hex, contra) >= minimo || p.l >= 1) return hex;
    p = { ...p, l: clamp(p.l + 0.01, 0, 1) };
  }
  return oklchAHex(p);
}

/** Mezcla dos colores en OKLab (t = 0 → a, t = 1 → b): sin grises sucios. */
function mezclar(x: string, y: string, t: number): string {
  const p = hexAOklch(x);
  const q = hexAOklch(y);
  const ab = (o: Oklch) => [o.c * Math.cos((o.h * Math.PI) / 180), o.c * Math.sin((o.h * Math.PI) / 180)];
  const [pa, pb] = ab(p);
  const [qa, qb] = ab(q);
  const A = pa + (qa - pa) * t;
  const B = pb + (qb - pb) * t;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return oklchAHex({ l: p.l + (q.l - p.l) * t, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h });
}

const triple = (hex: string) =>
  hexARgb(hex)
    .map((v) => Math.round(v * 255))
    .join(' ');
const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexARgb(hex).map((v) => Math.round(v * 255));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/* ------------------------------------------------------------------ */
/* Los temas                                                           */
/* ------------------------------------------------------------------ */

export interface ColoresTema {
  fondo: string;
  luz1: string;
  luz2: string;
}

export interface TemaListo extends ColoresTema {
  id: string;
  nombre: string;
  detalle: string;
}

/** El primero es el de siempre: el del ícono de la app. */
export const TEMAS_LISTOS: TemaListo[] = [
  // Como el ícono de la app: negro, azul eléctrico y trazos que brillan.
  { id: 'azul', nombre: 'Azul GEMB', detalle: 'Negro y azul eléctrico, como el ícono', fondo: '#03050f', luz1: '#7f9cff', luz2: '#2b59ff' },
  { id: 'dorado', nombre: 'Noche dorada', detalle: 'Negro y oro', fondo: '#07060a', luz1: '#e6c27a', luz2: '#b8862f' },
  { id: 'esmeralda', nombre: 'Esmeralda', detalle: 'Verde bosque y oro', fondo: '#03110c', luz1: '#e2c17d', luz2: '#17b37a' },
  { id: 'lila', nombre: 'Lila', detalle: 'Negro y morado', fondo: '#07040f', luz1: '#cdb4ff', luz2: '#8a3df0' },
  { id: 'rosa', nombre: 'Rosa', detalle: 'Vino y rosado', fondo: '#12050c', luz1: '#ffb3d9', luz2: '#e0337f' },
  { id: 'cielo', nombre: 'Cielo', detalle: 'Azul y turquesa', fondo: '#041019', luz1: '#8fe3ff', luz2: '#1f8fd6' },
];
export const TEMA_INICIAL = TEMAS_LISTOS[0];

/** El fondo siempre es oscuro: claridad entre 0,04 y 0,2 y poco croma. */
export function normalizarFondo(hex: string): string {
  const o = hexAOklch(hex);
  return oklchAHex({ l: clamp(o.l, 0.04, 0.2), c: Math.min(o.c, 0.06), h: o.h });
}
/** Las luces: ni tan oscuras que no se vean ni tan claras que no tengan color. */
export function normalizarLuz(hex: string): string {
  const o = hexAOklch(hex);
  return oklchAHex({ l: clamp(o.l, 0.45, 0.9), c: o.c, h: o.h });
}

/**
 * Todas las variables CSS del tema. Los nombres son los que ya usa la app:
 * --c-* (canales "R G B" para Tailwind: surface, white, primary, slate) y
 * --app-* (los de los componentes: tarjetas, botones, fondo con luces).
 */
export function tokensDeTema(entrada: ColoresTema): Record<string, string> {
  const fondo = normalizarFondo(hexValido(entrada.fondo) ?? TEMA_INICIAL.fondo);
  const luz1 = normalizarLuz(hexValido(entrada.luz1) ?? TEMA_INICIAL.luz1);
  const luz2 = normalizarLuz(hexValido(entrada.luz2) ?? TEMA_INICIAL.luz2);

  const f = hexAOklch(fondo);
  const a = hexAOklch(luz1);
  const b = hexAOklch(luz2);
  // Un gris no tiene tono fiable: se toma el de la otra luz.
  const h1 = a.c < 0.02 && b.c >= 0.02 ? b.h : a.h;
  const h2 = b.c < 0.02 && a.c >= 0.02 ? a.h : b.h;
  const c1 = Math.min(a.c, 0.17);
  // Las superficies oscuras toman el tono del fondo si el fondo tiene color.
  const hSup = f.c > 0.015 ? f.h : h2;
  const cSup = f.c > 0.015 ? Math.min(f.c + 0.01, 0.05) : Math.min(b.c * 0.2, 0.03);

  const panel = oklchAHex({ l: Math.max(f.l, 0.1) + 0.07, c: cSup, h: hSup });
  const panelAlto = oklchAHex({ l: Math.max(f.l, 0.1) + 0.11, c: cSup, h: hSup });

  // Textos (sobre el panel).
  const fuerte = conContraste({ l: 0.95, c: Math.min(c1 * 0.25, 0.03), h: h1 }, panel, 13);
  const suave = conContraste({ l: 0.8, c: Math.min(cSup + 0.01, 0.03), h: hSup }, panel, 7);
  const tenue = conContraste({ l: 0.66, c: Math.min(cSup, 0.03), h: hSup }, panel, 4.6);

  // El acento: claro, para que su letra oscura (el panel) se lea encima.
  const acento = conContraste({ l: clamp(a.l, 0.74, 0.86), c: c1, h: h1 }, panel, 7);
  const acentoO = hexAOklch(acento);
  const sobreAcento = oklchAHex({ l: 0.17, c: Math.min(c1 * 0.4, 0.05), h: h1 });

  const v: Record<string, string> = {
    '--c-surface': triple(fondo),
    '--c-white': triple(panel),
  };

  // primary: los oscuros son el panel con un toque del acento (fondos
  // suaves, chips, bordes); los claros, el acento para textos. El 500 es el
  // acento mismo (botones, insignias).
  const primario: Array<[string, string, number]> = [
    ['50', panel, 0.07],
    ['100', panelAlto, 0.1],
    ['200', panelAlto, 0.22],
    ['300', panelAlto, 0.5],
    ['400', panelAlto, 0.72],
  ];
  for (const [paso, base, t] of primario) {
    v[`--c-p-${paso}`] = triple(mezclar(base, acento, t));
  }
  v['--c-p-500'] = triple(acento);
  const claros: Array<[string, number, number]> = [
    ['600', 0.85, 0.75],
    ['700', 0.89, 0.55],
    ['800', 0.93, 0.35],
    ['900', 0.96, 0.2],
  ];
  for (const [paso, l, k] of claros) {
    v[`--c-p-${paso}`] = triple(oklchAHex({ l: Math.max(l, acentoO.l), c: c1 * k, h: h1 }));
  }

  // slate: los grises de la app (oscuros = fondos y bordes; claros = textos).
  const grises: Array<[string, number]> = [
    ['50', Math.max(f.l, 0.1) + 0.06],
    ['100', Math.max(f.l, 0.1) + 0.1],
    ['200', Math.max(f.l, 0.1) + 0.15],
    ['300', Math.max(f.l, 0.1) + 0.22],
  ];
  for (const [paso, l] of grises) {
    v[`--c-sl-${paso}`] = triple(oklchAHex({ l, c: cSup, h: hSup }));
  }
  v['--c-sl-400'] = triple(tenue);
  v['--c-sl-500'] = triple(conContraste({ l: 0.72, c: Math.min(cSup, 0.03), h: hSup }, panel, 5.5));
  v['--c-sl-600'] = triple(suave);
  v['--c-sl-700'] = triple(conContraste({ l: 0.86, c: Math.min(cSup, 0.025), h: hSup }, panel, 9));
  v['--c-sl-800'] = triple(conContraste({ l: 0.92, c: Math.min(cSup, 0.02), h: hSup }, panel, 11));
  v['--c-sl-900'] = triple(fuerte);

  // Fondo con dos luces (como el ícono) y semánticas de los componentes.
  const fondo2 = oklchAHex({ l: Math.max(f.l, 0.05) + 0.03, c: cSup, h: hSup });
  // Como el ícono: una luz fuerte abajo a la izquierda, un halo con anillo
  // arriba a la derecha y el centro casi negro. El vidrio de las tarjetas
  // necesita esas luces detrás para verse vidrio.
  v['--app-bg-gradient'] = [
    `radial-gradient(42% 28% at 100% 0%, transparent 55%, ${rgba(luz2, 0.12)} 61%, transparent 67%)`,
    `radial-gradient(62% 42% at 100% 0%, ${rgba(luz2, 0.34)}, transparent 70%)`,
    `radial-gradient(90% 55% at 0% 100%, ${rgba(luz2, 0.48)}, transparent 70%)`,
    `radial-gradient(70% 45% at 30% 45%, ${rgba(luz1, 0.05)}, transparent 70%)`,
    `linear-gradient(165deg, ${fondo} 0%, ${fondo2} 100%)`,
  ].join(', ');
  v['--app-panel'] = rgba(panel, 0.72);
  v['--app-panel-solid'] = panel;
  v['--app-soft-solid'] = panelAlto;
  v['--app-border'] = rgba(acento, 0.18);
  v['--app-border-strong'] = rgba(acento, 0.38);
  v['--app-strong'] = fuerte;
  v['--app-muted'] = suave;
  v['--app-faint'] = tenue;
  v['--app-accent'] = acento;
  v['--app-accent-strong'] = oklchAHex({ l: Math.min(acentoO.l + 0.07, 0.95), c: c1 * 0.6, h: h1 });
  v['--app-accent-gradient'] = `linear-gradient(135deg, ${oklchAHex({
    l: Math.min(acentoO.l + 0.08, 0.95),
    c: c1 * 0.7,
    h: h1,
  })} 0%, ${acento} 45%, ${oklchAHex({ l: Math.max(acentoO.l - 0.08, 0.68), c: c1, h: h1 })} 100%)`;
  v['--app-on-accent'] = sobreAcento;
  v['--app-glow-1'] = triple(oklchAHex({ l: Math.min(a.l, 0.75), c: a.c, h: h1 }));
  v['--app-glow-2'] = triple(oklchAHex({ l: Math.min(b.l, 0.68), c: b.c, h: h2 }));
  v['--app-danger'] = '#f87171';
  v['--app-meta'] = fondo;

  // El botón principal ("Tomar asistencia", "Yo la coordino"): del color de
  // la luz 2 con letra blanca, como los botones de Apple. Se oscurece lo justo
  // para que la letra blanca se lea (contraste 4,5 o más).
  let cta: Oklch = { l: clamp(b.l, 0.5, 0.62), c: Math.min(b.c, 0.24), h: h2 };
  for (let i = 0; i < 40 && contraste('#ffffff', oklchAHex(cta)) < 4.5; i += 1) {
    cta = { ...cta, l: cta.l - 0.01 };
  }
  const ctaHex = oklchAHex(cta);
  v['--app-cta'] = ctaHex;
  v['--app-cta-gradient'] = `linear-gradient(180deg, ${oklchAHex({ ...cta, l: cta.l + 0.09 })} 0%, ${ctaHex} 55%, ${oklchAHex({
    ...cta,
    l: cta.l - 0.06,
  })} 100%)`;
  v['--app-on-cta'] = '#ffffff';
  v['--app-cta-glow'] = triple(oklchAHex({ ...cta, l: Math.min(cta.l + 0.08, 0.72) }));
  return v;
}

/* ------------------------------------------------------------------ */
/* Guardar y aplicar                                                   */
/* ------------------------------------------------------------------ */

export interface Apariencia {
  /** id de un tema listo, o 'propio'. */
  tema: string;
  propio: ColoresTema;
}

export const APARIENCIA_CLAVE = 'gemb-apariencia';
/** Las variables ya calculadas: index.html las pone antes de que cargue React. */
export const VARIABLES_CLAVE = 'gemb-apariencia-vars';

export const APARIENCIA_INICIAL: Apariencia = {
  tema: TEMA_INICIAL.id,
  propio: { fondo: '#0a1024', luz1: '#8fe3ff', luz2: '#7634e8' },
};

export function limpiarApariencia(valor: unknown): Apariencia {
  const v = (valor && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
  const p = (v.propio && typeof v.propio === 'object' ? v.propio : {}) as Record<string, unknown>;
  const tema =
    v.tema === 'propio' || TEMAS_LISTOS.some((t) => t.id === v.tema) ? String(v.tema) : TEMA_INICIAL.id;
  return {
    tema,
    propio: {
      fondo: hexValido(p.fondo) ?? APARIENCIA_INICIAL.propio.fondo,
      luz1: hexValido(p.luz1) ?? APARIENCIA_INICIAL.propio.luz1,
      luz2: hexValido(p.luz2) ?? APARIENCIA_INICIAL.propio.luz2,
    },
  };
}

export function coloresDe(a: Apariencia): ColoresTema {
  if (a.tema === 'propio') return a.propio;
  return TEMAS_LISTOS.find((t) => t.id === a.tema) ?? TEMA_INICIAL;
}

export function leerApariencia(): Apariencia {
  try {
    return limpiarApariencia(JSON.parse(localStorage.getItem(APARIENCIA_CLAVE) || 'null'));
  } catch {
    return APARIENCIA_INICIAL;
  }
}

/** Pinta la app con estos colores (sin guardarlos: sirve también de vista previa). */
export function aplicarColores(c: ColoresTema): Record<string, string> {
  const vars = tokensDeTema(c);
  const raiz = document.documentElement;
  for (const [k, val] of Object.entries(vars)) raiz.style.setProperty(k, val);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--app-meta']);
  return vars;
}

export function guardarApariencia(a: Apariencia) {
  const vars = aplicarColores(coloresDe(a));
  try {
    localStorage.setItem(APARIENCIA_CLAVE, JSON.stringify(a));
    localStorage.setItem(VARIABLES_CLAVE, JSON.stringify(vars));
  } catch {
    /* modo privado: se ve bien igual, solo no se recuerda */
  }
}
