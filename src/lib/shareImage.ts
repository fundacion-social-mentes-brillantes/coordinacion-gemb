import type { Modality, SessionType } from '../types';
import { SESSION_TYPE_LABELS, MODALITY_LABELS } from './constants';

/**
 * Genera una imagen PNG bonita con la lista de asistencia, pensada para
 * enviarla por WhatsApp al grupo de coordinadoras.
 *
 * Se dibuja con Canvas 2D nativo (sin librerías) para que salga nítida y
 * funcione igual en iPhone y Android. Todo el trazado usa `arcTo` en vez de
 * `roundRect` porque este último no existe en Safari antiguo.
 */

const W = 1080; // ancho fijo: se ve bien en cualquier chat
const PAD = 48; // margen exterior
const CARD_R = 44;
const ROW_H = 76;
const TWO_COL_FROM = 22; // a partir de tantos nombres, dos columnas
/**
 * Alto máximo de la zona de nombres. Safari en iPhone deja el lienzo en
 * blanco si la imagen se pasa de unos 4.000 px de alto, así que a partir de
 * cierta cantidad de gente se reparte en más columnas en vez de crecer.
 */
const MAX_LIST_H = 3000;
const MAX_COLS = 4;

interface Palette {
  from: string;
  to: string;
  accent: string;
  soft: string;
  onHeader: string;
  headerMuted: string;
}

// Cada tipo de reunión tiene su color para distinguirlas de un vistazo.
const PALETTES: Record<SessionType, Palette> = {
  entrega_pasos: {
    from: '#1b6d59',
    to: '#2fa583',
    accent: '#1f7862',
    soft: '#e9f5f0',
    onHeader: '#ffffff',
    headerMuted: 'rgba(255,255,255,0.82)',
  },
  reduccion_ego: {
    from: '#0b1020',
    to: '#2a3350',
    accent: '#a8801d',
    soft: '#f7f1de',
    onHeader: '#f6e4b0',
    headerMuted: 'rgba(246,228,176,0.78)',
  },
};

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const font = (size: number, weight = '400') => `${weight} ${size}px ${FONT}`;

/** Rectángulo redondeado compatible con navegadores viejos. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Recorta un texto con "…" para que quepa en `maxW`. */
function ellipsize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string {
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

/** Píldora de texto (chip) usada en la cabecera. */
function drawChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  colors: { bg: string; fg: string },
): number {
  ctx.font = font(26, '600');
  const tw = ctx.measureText(text).width;
  const w = tw + 44;
  const h = 52;
  ctx.fillStyle = colors.bg;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = colors.fg;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 22, y + h / 2 + 1);
  return w;
}

/**
 * Carga el logo una sola vez y guarda la promesa.
 *
 * Se precarga al abrir la app para que al pulsar "Compartir" la imagen se
 * arme al instante: en iPhone, si entre el toque y `navigator.share` pasa
 * demasiado tiempo, el sistema bloquea el menú de compartir.
 */
let logoPromise: Promise<HTMLImageElement | null> | null = null;

export function preloadLogo(): Promise<HTMLImageElement | null> {
  if (logoPromise) return logoPromise;
  logoPromise = new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let settled = false;
      const done = (v: HTMLImageElement | null, porTiempo = false) => {
        if (settled) return;
        settled = true;
        // Si solo se agotó el tiempo, no se recuerda el "sin logo": la
        // próxima vez se vuelve a intentar (quizá ya esté en caché).
        if (porTiempo) logoPromise = null;
        resolve(v);
      };
      img.onload = () => done(img);
      img.onerror = () => done(null);
      // Si tarda demasiado, seguimos sin logo (no bloquear a la usuaria).
      setTimeout(() => done(null, true), 1200);
      img.src = '/logo.png';
    } catch {
      resolve(null);
    }
  });
  return logoPromise;
}

export interface AttendanceImageInput {
  type: SessionType;
  modality: Modality;
  /** Fecha ya formateada en largo, ej. "martes 5 de agosto de 2026". */
  dateLabel: string;
  coordinator?: string;
  /** Nombres en orden de llegada. */
  names: string[];
}

/** Dibuja la lista de asistencia y devuelve el PNG como Blob. */
export async function buildAttendanceImage(
  data: AttendanceImageInput,
): Promise<Blob> {
  const pal = PALETTES[data.type];
  const names = data.names;
  // Columnas: 1 normalmente, 2 con mucha gente y 3 si aun así sería
  // demasiado alta (el iPhone no dibuja lienzos gigantes).
  let cols = names.length > TWO_COL_FROM ? 2 : 1;
  while (
    cols < MAX_COLS &&
    Math.ceil(names.length / cols) * ROW_H > MAX_LIST_H
  ) {
    cols++;
  }
  const twoCols = cols > 1;
  const rowsPerCol = Math.ceil(names.length / cols);
  // Si ni con las columnas cabe, se aprietan un poco las filas antes que
  // generar una imagen tan alta que el iPhone no pueda dibujar.
  const rowH =
    rowsPerCol > 0
      ? Math.max(40, Math.min(ROW_H, MAX_LIST_H / rowsPerCol))
      : ROW_H;

  const cardX = PAD;
  const cardW = W - PAD * 2;
  const headerH = data.coordinator ? 340 : 300;
  const listTop = headerH + 28;
  const listH = Math.max(rowH, rowsPerCol * rowH) + 24;
  const footerH = 104;
  const cardH = headerH + listH + footerH;
  const H = cardH + PAD * 2;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar la imagen.');

  // --- Fondo suave ---
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, pal.soft);
  bg.addColorStop(1, '#ffffff');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // --- Tarjeta blanca con sombra ---
  ctx.save();
  ctx.shadowColor = 'rgba(10, 20, 35, 0.18)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, cardX, PAD, cardW, cardH, CARD_R);
  ctx.fill();
  ctx.restore();

  // --- Cabecera con degradado (recortada a la tarjeta) ---
  ctx.save();
  roundRect(ctx, cardX, PAD, cardW, cardH, CARD_R);
  ctx.clip();
  const hg = ctx.createLinearGradient(cardX, PAD, cardX + cardW, PAD + headerH);
  hg.addColorStop(0, pal.from);
  hg.addColorStop(1, pal.to);
  ctx.fillStyle = hg;
  ctx.fillRect(cardX, PAD, cardW, headerH);

  // Círculo decorativo tenue.
  ctx.globalAlpha = 0.09;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cardX + cardW - 60, PAD + 40, 190, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  // --- Logo (o monograma) ---
  const logo = await preloadLogo();
  const logoS = 92;
  const logoX = cardX + 52;
  const logoY = PAD + 46;
  ctx.save();
  ctx.beginPath();
  ctx.arc(logoX + logoS / 2, logoY + logoS / 2, logoS / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fill();
  ctx.clip();
  if (logo) {
    ctx.drawImage(logo, logoX, logoY, logoS, logoS);
  } else {
    ctx.fillStyle = pal.from;
    ctx.font = font(38, '800');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MB', logoX + logoS / 2, logoY + logoS / 2 + 2);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  // --- Textos de cabecera ---
  const textX = logoX + logoS + 28;
  const textMaxW = cardX + cardW - textX - 52;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = pal.headerMuted;
  ctx.font = font(25, '600');
  ctx.fillText('LISTA DE ASISTENCIA', textX, PAD + 82);

  ctx.fillStyle = pal.onHeader;
  ctx.font = font(46, '800');
  ctx.fillText(
    ellipsize(ctx, SESSION_TYPE_LABELS[data.type], textMaxW),
    textX,
    PAD + 136,
  );

  ctx.fillStyle = pal.headerMuted;
  ctx.font = font(28, '500');
  const dateTxt = data.dateLabel.charAt(0).toUpperCase() + data.dateLabel.slice(1);
  ctx.fillText(ellipsize(ctx, dateTxt, textMaxW), textX, PAD + 182);

  // Píldoras: modalidad + total de presentes.
  const chipY = PAD + 212;
  let chipX = textX;
  chipX += drawChip(ctx, MODALITY_LABELS[data.modality], chipX, chipY, {
    bg: 'rgba(255,255,255,0.20)',
    fg: pal.onHeader,
  }) + 14;
  drawChip(
    ctx,
    `${names.length} ${names.length === 1 ? 'presente' : 'presentes'}`,
    chipX,
    chipY,
    { bg: pal.onHeader, fg: pal.from },
  );

  // Franja de "Coordina:".
  if (data.coordinator) {
    ctx.save();
    roundRect(ctx, cardX, PAD, cardW, cardH, CARD_R);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(cardX, PAD + headerH - 62, cardW, 62);
    ctx.fillStyle = pal.onHeader;
    ctx.font = font(27, '600');
    ctx.textBaseline = 'middle';
    ctx.fillText(
      ellipsize(ctx, `Coordina: ${data.coordinator}`, cardW - 104),
      cardX + 52,
      PAD + headerH - 31,
    );
    ctx.restore();
  }

  // --- Lista de nombres ---
  const listX = cardX + 44;
  const listW = cardW - 88;
  const GAP = 20;
  const colW = (listW - GAP * (cols - 1)) / cols;

  names.forEach((name, i) => {
    const col = twoCols ? Math.floor(i / rowsPerCol) : 0;
    const rowInCol = twoCols ? i % rowsPerCol : i;
    const x = listX + col * (colW + GAP);
    const y = PAD + listTop + rowInCol * rowH;

    // Fondo alterno para leer sin perderse de renglón.
    if (rowInCol % 2 === 0) {
      ctx.fillStyle = pal.soft;
      roundRect(ctx, x - 10, y - 6, colW + 20, rowH - 10, 16);
      ctx.fill();
    }

    // Número en círculo.
    const cy = y + (rowH - 10) / 2 - 6;
    ctx.fillStyle = pal.accent;
    ctx.beginPath();
    ctx.arc(x + 24, cy, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = font(22, '700');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x + 24, cy + 1);

    // Nombre. En dos columnas la letra baja un poco para que quepan los
    // nombres largos sin cortarse.
    ctx.textAlign = 'left';
    ctx.fillStyle = '#16233a';
    ctx.font = font(cols === 1 ? 30 : cols === 2 ? 26 : cols === 3 ? 22 : 19, '600');
    ctx.fillText(ellipsize(ctx, name, colW - 66), x + 56, cy + 1);
  });

  if (names.length === 0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#94a3b8';
    ctx.font = font(30, '500');
    ctx.fillText('Sin personas registradas', W / 2, PAD + listTop + 40);
    ctx.textAlign = 'left';
  }

  // --- Pie ---
  const footY = PAD + cardH - footerH;
  ctx.strokeStyle = '#e6ebf2';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + 44, footY);
  ctx.lineTo(cardX + cardW - 44, footY);
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.fillStyle = pal.accent;
  ctx.font = font(27, '700');
  ctx.fillText(
    'Gimnasio Emocional Mentes Brillantes',
    cardX + 44,
    footY + footerH / 2,
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = '#94a3b8';
  ctx.font = font(23, '500');
  ctx.fillText('Coordinación', cardX + cardW - 44, footY + footerH / 2);
  ctx.textAlign = 'left';

  // --- A PNG ---
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo crear la imagen.'))),
      'image/png',
    );
  });
}

/** Nombre de archivo limpio para la imagen. */
export function attendanceImageName(type: SessionType, dateLabel: string) {
  const slug = dateLabel
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const kind = type === 'reduccion_ego' ? 'reduccion-del-ego' : 'entrega-de-pasos';
  return `asistencia-${kind}-${slug}.png`;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded' | 'opened';

/**
 * Comparte la imagen con el menú nativo del celular (WhatsApp, etc.).
 *
 * Importante: debe llamarse INMEDIATAMENTE tras el toque de la usuaria. Por
 * eso la imagen se prepara antes (ver `shareList` en la pantalla): si entre
 * el toque y esta llamada pasa demasiado tiempo, iOS bloquea el menú.
 *
 * Si no se puede compartir se descarga; y si el navegador tampoco permite
 * descargar (iPhone con la app instalada), se abre en una pestaña para que
 * la usuaria la guarde con "mantener pulsado → Guardar en Fotos".
 */
export async function shareOrDownloadImage(
  blob: Blob,
  filename: string,
  text: string,
): Promise<ShareOutcome> {
  const nav = navigator as Navigator & {
    canShare?: (d: unknown) => boolean;
    share?: (d: unknown) => Promise<void>;
  };
  try {
    const file = new File([blob], filename, { type: 'image/png' });
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], text });
      return 'shared';
    }
  } catch (e) {
    // Si la usuaria cierra el menú de compartir, no descargamos a la fuerza.
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    console.warn('No se pudo compartir; se intentará descargar.', e);
  }

  const url = URL.createObjectURL(blob);
  // En el iPhone con la app instalada el atributo `download` no funciona:
  // ahí se abre la imagen para poder guardarla a mano.
  const soportaDescarga = 'download' in document.createElement('a');
  const esIOS =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (soportaDescarga && !esIOS) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'downloaded';
  }

  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'opened';
}
