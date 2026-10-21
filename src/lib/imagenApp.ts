import { coloresDe, leerApariencia, tokensDeTema } from './tema';

// ---------------------------------------------------------------------------
//  Lo común de las imágenes que se mandan al grupo de WhatsApp (la lista de
//  asistencia y la programación del mes), con el DISEÑO DE LA APP: su fondo
//  oscuro con las luces, el vidrio de las tarjetas, el ícono de verdad y la
//  marca «Coordinación GEMB» (pedido del 20 oct 2026: «que se vea profesional,
//  como la de la Agenda»). Toma los colores que la persona eligió en Ajustes,
//  igual que la imagen del día de Agenda MB.
//
//  Canvas 2D nativo: nítido en cualquier celular. Todo el trazado usa `arcTo`
//  (no `roundRect`) porque Safari viejo no lo tiene.
// ---------------------------------------------------------------------------

export const ANCHO = 1080;
export const MARGEN = 60;

export const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
export const font = (size: number, weight = '400') => `${weight} ${size}px ${FONT}`;
const FONT_MARCA = `"League Spartan", ${FONT}`;
const FONT_GEMB = `"Glacial Indifference", ${FONT}`;

type Rgb = [number, number, number];

export interface TemaImagen {
  fondo: string;
  fondo2: string;
  luz1: Rgb;
  luz2: Rgb;
  panel: string;
  fuerte: string;
  suave: string;
  tenue: string;
  acento: string;
  /** Las tres paradas del degradado del acento (claro → acento → oscuro). */
  acentoDegradado: string[];
  sobreAcento: string;
}

/** Los colores del tema que la persona tiene puesto (el inicial: Azul GEMB). */
export function temaDeImagen(): TemaImagen {
  const v = tokensDeTema(coloresDe(leerApariencia()));
  const hexes = (s: string | undefined) => s?.match(/#[0-9a-f]{6}/gi) ?? [];
  const trio = (s: string | undefined): Rgb => {
    const n = (s ?? '').split(' ').map(Number);
    return n.length === 3 && n.every((x) => Number.isFinite(x)) ? (n as Rgb) : [43, 89, 255];
  };
  // En el fondo, los únicos colores en hex son los dos del degradado lineal.
  const fondoHex = hexes(v['--app-bg-gradient']);
  const grad = hexes(v['--app-accent-gradient']);
  return {
    fondo: v['--app-meta'],
    fondo2: fondoHex[fondoHex.length - 1] ?? v['--app-meta'],
    luz1: trio(v['--app-glow-1']),
    luz2: trio(v['--app-glow-2']),
    panel: v['--app-panel-solid'],
    fuerte: v['--app-strong'],
    suave: v['--app-muted'],
    tenue: v['--app-faint'],
    acento: v['--app-accent'],
    acentoDegradado: grad.length === 3 ? grad : [v['--app-accent'], v['--app-accent'], v['--app-accent']],
    sobreAcento: v['--app-on-accent'],
  };
}

export const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;
export function hexRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * El color de cada reunión, igual que en «Para la reunión» de la app (16 oct
 * 2026): Entrega de Pasos en vino tinto y la Sala de Reducción del Ego en
 * azul profundo, translúcidos.
 */
export interface Tono {
  base: Rgb;
  claro: string;
  oscuro: string;
  texto: string;
  letra: string;
}
export const TONO_VINO: Tono = { base: [136, 30, 62], claro: '#c0566f', oscuro: '#5e1129', texto: '#ffffff', letra: '#f0b9c6' };
export const TONO_AZUL: Tono = { base: [44, 78, 180], claro: '#6f8fe6', oscuro: '#1c3384', texto: '#ffffff', letra: '#bccbf6' };
/** El dorado de «Coordina … (tú)» en la app. */
export const ORO = '#f5c451';

/** Rectángulo redondeado compatible con navegadores viejos. */
export function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Recorta un texto con «…» para que quepa en `maxW` (con la letra ya puesta). */
export function recortar(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}

/**
 * Texto con letras separadas (los rótulos en mayúscula de la app). Se dibuja
 * letra por letra: `ctx.letterSpacing` no existe en los Safari de antes.
 */
export function espaciado(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, sep: number): number {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + sep;
  }
  return cx - sep - x;
}

/** El fondo de la app: degradado oscuro y las luces del ícono. */
export function fondoApp(ctx: CanvasRenderingContext2D, alto: number, t: TemaImagen) {
  const W = ANCHO;
  const lineal = ctx.createLinearGradient(0, 0, W * 0.27, alto);
  lineal.addColorStop(0, t.fondo);
  lineal.addColorStop(1, t.fondo2);
  ctx.fillStyle = lineal;
  ctx.fillRect(0, 0, W, alto);

  const luz = (x: number, y: number, r: number, paradas: [number, string][]) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (const [p, c] of paradas) g.addColorStop(p, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, alto);
  };
  // Arriba a la derecha: el halo con su anillo, como en el ícono.
  luz(W, 0, W * 0.78, [
    [0, rgba(t.luz2, 0.36)],
    [1, rgba(t.luz2, 0)],
  ]);
  luz(W, 0, W * 0.62, [
    [0.55, rgba(t.luz2, 0)],
    [0.61, rgba(t.luz2, 0.14)],
    [0.67, rgba(t.luz2, 0)],
  ]);
  // Una luz suave del acento por el centro.
  luz(W * 0.3, Math.min(alto * 0.45, 900), W * 0.8, [
    [0, rgba(t.luz1, 0.06)],
    [1, rgba(t.luz1, 0)],
  ]);
  // Abajo a la izquierda: la luz fuerte.
  luz(0, alto, W * 1.05, [
    [0, rgba(t.luz2, 0.5)],
    [1, rgba(t.luz2, 0)],
  ]);
  // Viñeta: los bordes un poco más oscuros, como una foto.
  const vin = ctx.createRadialGradient(W / 2, alto / 2, Math.min(W, alto) * 0.35, W / 2, alto / 2, Math.max(W, alto) * 0.75);
  vin.addColorStop(0, 'rgba(0,0,0,0)');
  vin.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = vin;
  ctx.fillRect(0, 0, W, alto);
}

/**
 * Una tarjeta de vidrio, como `.card` de la app: panel translúcido, un brillo
 * de arriba hacia abajo y el borde de luz (blanco arriba a la izquierda, del
 * color de la luz abajo a la derecha).
 */
export function vidrio(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  t: TemaImagen,
  tinte?: Rgb,
) {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 22;
  rect(ctx, x, y, w, h, r);
  const [pr, pg, pb] = hexRgb(t.panel);
  ctx.fillStyle = `rgba(${pr}, ${pg}, ${pb}, 0.62)`;
  ctx.fill();
  ctx.restore();

  ctx.save();
  rect(ctx, x, y, w, h, r);
  ctx.clip();
  if (tinte) {
    const tg = ctx.createLinearGradient(x, y, x + w, y + h);
    tg.addColorStop(0, rgba(tinte, 0.42));
    tg.addColorStop(0.5, rgba(tinte, 0.16));
    tg.addColorStop(1, 'rgba(8, 12, 28, 0.3)');
    ctx.fillStyle = tg;
    ctx.fillRect(x, y, w, h);
  }
  const brillo = ctx.createLinearGradient(0, y, 0, y + Math.min(h, 420));
  brillo.addColorStop(0, 'rgba(255, 255, 255, 0.09)');
  brillo.addColorStop(0.42, 'rgba(255, 255, 255, 0.025)');
  brillo.addColorStop(1, 'rgba(255, 255, 255, 0.012)');
  ctx.fillStyle = brillo;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  const borde = ctx.createLinearGradient(x, y, x + w * 0.9, y + h);
  borde.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
  borde.addColorStop(0.26, 'rgba(255, 255, 255, 0.08)');
  borde.addColorStop(0.52, 'rgba(255, 255, 255, 0.0)');
  borde.addColorStop(1, rgba(tinte ?? t.luz2, 0.4));
  ctx.strokeStyle = borde;
  ctx.lineWidth = 2;
  rect(ctx, x + 1, y + 1, w - 2, h - 2, r - 1);
  ctx.stroke();
}

/** Píldora de texto. Devuelve su ancho. */
export function chip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  estilo: { fondo: string | CanvasGradient; letra: string; borde?: string },
  alto = 54,
): number {
  ctx.font = font(25, '700');
  const w = ctx.measureText(text).width + 48;
  rect(ctx, x, y, w, alto, alto / 2);
  ctx.fillStyle = estilo.fondo;
  ctx.fill();
  if (estilo.borde) {
    ctx.strokeStyle = estilo.borde;
    ctx.lineWidth = 2;
    rect(ctx, x + 1, y + 1, w - 2, alto - 2, alto / 2 - 1);
    ctx.stroke();
  }
  ctx.fillStyle = estilo.letra;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 24, y + alto / 2 + 1);
  ctx.textBaseline = 'alphabetic';
  return w;
}

/** El degradado del acento para una píldora (como los botones de la app). */
export function degradadoAcento(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, t: TemaImagen) {
  const g = ctx.createLinearGradient(x, y, x + w, y + 54);
  const [a, b, c] = t.acentoDegradado;
  g.addColorStop(0, a);
  g.addColorStop(0.45, b);
  g.addColorStop(1, c);
  return g;
}

/**
 * La cabecera de marca: el ícono de la app y «Coordinación» con «GEMB»
 * debajo, como en la entrada de la app.
 */
export function marcaApp(ctx: CanvasRenderingContext2D, x: number, y: number, icono: HTMLImageElement | null, t: TemaImagen) {
  const s = 100;
  ctx.save();
  ctx.shadowColor = rgba(t.luz2, 0.55);
  ctx.shadowBlur = 40;
  rect(ctx, x, y, s, s, 26);
  ctx.fillStyle = '#03050f';
  ctx.fill();
  ctx.restore();
  if (icono) {
    ctx.save();
    rect(ctx, x, y, s, s, 26);
    ctx.clip();
    ctx.drawImage(icono, x, y, s, s);
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 2;
  rect(ctx, x + 1, y + 1, s - 2, s - 2, 25);
  ctx.stroke();

  const tx = x + s + 26;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 56px ${FONT_MARCA}`;
  const ancho = ctx.measureText('Coordinación').width;
  // El mismo degradado de la marca en la app (blanco y azul que brilla).
  const g = ctx.createLinearGradient(tx, 0, tx + ancho, 0);
  g.addColorStop(0, '#6f8fff');
  g.addColorStop(0.22, '#c9d6ff');
  g.addColorStop(0.42, '#ffffff');
  g.addColorStop(0.6, '#c9d6ff');
  g.addColorStop(0.85, '#5b7dff');
  g.addColorStop(1, '#e3eaff');
  ctx.fillStyle = g;
  ctx.fillText('Coordinación', tx, y + 58);
  ctx.fillStyle = 'rgba(201, 214, 255, 0.78)';
  ctx.font = `400 21px ${FONT_GEMB}`;
  espaciado(ctx, 'GEMB', tx + 3, y + 92, 11);
}

/** El pie: de dónde sale la imagen. */
export function pieApp(ctx: CanvasRenderingContext2D, y: number, t: TemaImagen, detalle: string) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = t.tenue;
  ctx.font = font(22, '500');
  ctx.fillText(detalle, ANCHO / 2, y);
  ctx.textAlign = 'left';
}

/**
 * El ícono y las letras de la marca, una sola vez. Se llama al abrir la
 * pantalla para que, al tocar «Compartir», la imagen se arme al instante: en
 * iPhone, si entre el toque y el menú de compartir pasa mucho tiempo, el
 * sistema lo bloquea.
 */
let recursos: Promise<HTMLImageElement | null> | null = null;

export function prepararImagenApp(): Promise<HTMLImageElement | null> {
  if (recursos) return recursos;
  recursos = new Promise((resolve) => {
    let listo = false;
    const fin = (v: HTMLImageElement | null, porTiempo = false) => {
      if (listo) return;
      listo = true;
      // Si solo se agotó el tiempo, la próxima vez se vuelve a intentar.
      if (porTiempo) recursos = null;
      resolve(v);
    };
    setTimeout(() => fin(null, true), 2500);
    const letras = document.fonts
      ? Promise.all([
          document.fonts.load(`700 56px "League Spartan"`),
          document.fonts.load(`400 21px "Glacial Indifference"`),
        ]).catch(() => [])
      : Promise.resolve([]);
    const icono = new Promise<HTMLImageElement | null>((ok) => {
      try {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = () => ok(null);
        // El ícono de la app (el del celular y la barra de arriba).
        img.src = '/pwa-512x512.png';
      } catch {
        ok(null);
      }
    });
    void Promise.all([icono, letras]).then(([img]) => fin(img));
  });
  return recursos;
}

/** El lienzo listo, o un error que se entiende. */
export function lienzo(alto: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = ANCHO;
  canvas.height = Math.ceil(alto);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar la imagen.');
  return { canvas, ctx };
}

export function aPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo crear la imagen.'))), 'image/png'),
  );
}
