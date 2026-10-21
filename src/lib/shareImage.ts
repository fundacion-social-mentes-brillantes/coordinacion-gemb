import type { Modality, SessionType } from '../types';
import { SESSION_TYPE_LABELS, MODALITY_LABELS } from './constants';
import {
  ANCHO,
  MARGEN,
  ORO,
  TONO_AZUL,
  TONO_VINO,
  CEREBRO,
  aPng,
  cargarImagen,
  chip,
  degradadoAcento,
  espaciado,
  fondoApp,
  font,
  lienzo,
  marcaApp,
  pieApp,
  prepararImagenApp,
  recortar,
  rect,
  rgba,
  temaDeImagen,
  vidrio,
  type Tono,
} from './imagenApp';
import { compartirArchivo, enAppAndroid } from './nativo';

/**
 * La imagen de la lista de asistencia para el grupo de WhatsApp, con el
 * diseño de la app (ver imagenApp.ts). Antes era una tarjeta blanca con el
 * logo viejo; desde el 20 oct 2026 va como la imagen del día de Agenda MB:
 * fondo de la app, ícono, marca y vidrio. La lista va en franjas de colores
 * con un cerebrito dorado y el número grande, como el ejemplo que mandó.
 */

/**
 * Alto máximo de la zona de nombres. Safari en iPhone deja el lienzo en
 * blanco si la imagen se pasa de unos 4.000 px de alto, así que a partir de
 * cierta cantidad de gente se reparte en más columnas en vez de crecer.
 */
const MAX_LIST_H = 3000;

/** Cada reunión con su color, como en «Para la reunión» (la píldora). */
const TONOS: Record<SessionType, Tono> = {
  entrega_pasos: TONO_VINO,
  reduccion_ego: TONO_AZUL,
};

/**
 * Las franjas de la lista, como el ejemplo que mandó (20 oct 2026): un
 * cuadro de color con el cerebrito dorado, el número grande en una franja
 * clara y la barra de color con el nombre. Los colores van rotando.
 */
interface ColorFila {
  fondo: string;
  numero: string;
  letra: string;
}
const FILAS: ColorFila[] = [
  { fondo: '#66a9a6', numero: '#4f9592', letra: '#ffffff' },
  { fondo: '#9edac8', numero: '#55b398', letra: '#173430' },
  { fondo: '#b9ca55', numero: '#97a92f', letra: '#26300a' },
  { fondo: '#e1d36d', numero: '#c2ae38', letra: '#3a3008' },
];
/** El fondo claro de la «pantalla» donde van las franjas. */
const PANTALLA = '#eef0f5';

/** Rectángulo con solo dos esquinas redondeadas (las de un lado). */
function medioRedondo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  lado: 'izquierda' | 'derecha',
) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  if (lado === 'izquierda') {
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
  } else {
    ctx.moveTo(x, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.lineTo(x, y + h);
  }
  ctx.closePath();
}

/** El ícono y las letras, de antemano (ver prepararImagenApp). */
export const preloadLogo = prepararImagenApp;

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
export async function buildAttendanceImage(data: AttendanceImageInput): Promise<Blob> {
  const names = data.names;
  // Columnas: una franja por persona; con mucha gente, en dos o más columnas
  // (el iPhone no dibuja lienzos gigantes).
  const n = names.length;
  const cols = n <= 24 ? 1 : n <= 60 ? 2 : n <= 99 ? 3 : 4;
  const rowsPerCol = Math.max(1, Math.ceil(n / cols));
  let rowH = [84, 64, 50, 44][cols - 1];
  let gap = Math.round(rowH * 0.3);
  // Si ni así cabe, se aprietan un poco las franjas.
  const alto = rowsPerCol * (rowH + gap) - gap;
  if (alto > MAX_LIST_H) {
    const k = MAX_LIST_H / alto;
    rowH = Math.max(30, Math.floor(rowH * k));
    gap = Math.max(6, Math.floor(gap * k));
  }

  const t = temaDeImagen();
  const tono = TONOS[data.type];
  const [icono, cerebro] = await Promise.all([prepararImagenApp(), cargarImagen(CEREBRO)]);

  const anchoUtil = ANCHO - MARGEN * 2;
  const yChips = 428;
  const altoChip = 56;
  const altoCoord = 118;
  const yCoord = yChips + altoChip + 34;
  const yLista = data.coordinator ? yCoord + altoCoord + 22 : yCoord;
  const padX = 34;
  const padY = 40;
  const altoLista = n ? rowsPerCol * (rowH + gap) - gap + padY * 2 : 170;
  const yPie = yLista + altoLista + 76;
  const { canvas, ctx } = lienzo(yPie + 58);

  fondoApp(ctx, canvas.height, t);
  marcaApp(ctx, MARGEN, 60, icono, t);

  // --- Qué reunión y cuándo ---
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = t.acento;
  ctx.font = font(23, '800');
  espaciado(ctx, 'LISTA DE ASISTENCIA', MARGEN + 2, 262, 5);

  ctx.fillStyle = t.fuerte;
  ctx.font = font(66, '800');
  ctx.fillText(recortar(ctx, SESSION_TYPE_LABELS[data.type], anchoUtil), MARGEN, 342);

  ctx.fillStyle = t.suave;
  ctx.font = font(33, '500');
  const fecha = data.dateLabel.charAt(0).toUpperCase() + data.dateLabel.slice(1);
  ctx.fillText(recortar(ctx, fecha, anchoUtil), MARGEN, 396);

  // Píldoras: la modalidad (con el color de la reunión) y los presentes.
  let x = MARGEN;
  x +=
    chip(ctx, MODALITY_LABELS[data.modality], x, yChips, {
      fondo: rgba(tono.base, 0.42),
      letra: tono.letra,
      borde: rgba(tono.base, 0.85),
    }, altoChip) + 14;
  const presentes = `${names.length} ${names.length === 1 ? 'presente' : 'presentes'}`;
  ctx.font = font(25, '700');
  const anchoPresentes = ctx.measureText(presentes).width + 48;
  chip(ctx, presentes, x, yChips, { fondo: degradadoAcento(ctx, x, yChips, anchoPresentes, t), letra: t.sobreAcento }, altoChip);

  // --- Quién coordinó, en dorado como en la app ---
  if (data.coordinator) {
    vidrio(ctx, MARGEN, yCoord, anchoUtil, altoCoord, 32, t);
    const r = 33;
    const cx = MARGEN + 30 + r;
    const cy = yCoord + altoCoord / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(245, 196, 81, 0.14)';
    ctx.fill();
    ctx.strokeStyle = ORO;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    const iniciales = data.coordinator
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
    ctx.fillStyle = ORO;
    ctx.font = font(25, '800');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(iniciales, cx, cy + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const tx = cx + r + 24;
    ctx.fillStyle = t.tenue;
    ctx.font = font(19, '800');
    espaciado(ctx, 'COORDINA', tx, yCoord + 48, 4);
    ctx.fillStyle = ORO;
    ctx.font = font(35, '700');
    ctx.fillText(recortar(ctx, data.coordinator, MARGEN + anchoUtil - tx - 30), tx, yCoord + 90);
  }

  // --- La lista: la «pantalla» clara con una franja por persona ---
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 22;
  rect(ctx, MARGEN, yLista, anchoUtil, altoLista, 30);
  ctx.fillStyle = PANTALLA;
  ctx.fill();
  ctx.restore();

  const GAP_COL = 26;
  const colW = (anchoUtil - padX * 2 - GAP_COL * (cols - 1)) / cols;
  const cuadro = rowH;
  const franja = Math.round(rowH * 0.98);
  const radio = Math.round(rowH * 0.16);
  const tamNombre = Math.min([31, 25, 21, 18][cols - 1], Math.round(rowH * 0.4));

  names.forEach((name, i) => {
    const c = FILAS[i % FILAS.length];
    const col = Math.floor(i / rowsPerCol);
    const fila = i % rowsPerCol;
    const x0 = MARGEN + padX + col * (colW + GAP_COL);
    const y0 = yLista + padY + fila * (rowH + gap);
    const cy = y0 + rowH / 2;

    // El cuadro de color con el cerebrito dorado.
    medioRedondo(ctx, x0, y0, cuadro, rowH, radio, 'izquierda');
    ctx.fillStyle = c.fondo;
    ctx.fill();
    if (cerebro) {
      const b = Math.round(cuadro * 0.84);
      ctx.save();
      ctx.shadowColor = 'rgba(55, 35, 0, 0.55)';
      ctx.shadowBlur = Math.max(4, Math.round(rowH * 0.09));
      ctx.shadowOffsetY = Math.max(1, Math.round(rowH * 0.03));
      ctx.drawImage(cerebro, x0 + (cuadro - b) / 2, cy - b / 2, b, b);
      ctx.restore();
    }

    // La barra de color con el nombre.
    const bx = x0 + cuadro + franja;
    const bw = colW - cuadro - franja;
    medioRedondo(ctx, bx, y0, bw, rowH, radio, 'derecha');
    ctx.fillStyle = c.fondo;
    ctx.fill();
    ctx.fillStyle = c.letra;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const sangria = Math.max(16, Math.round(rowH * 0.32));
    // Un nombre largo baja un poco la letra antes de cortarse con «…».
    let tam = tamNombre;
    ctx.font = font(tam, '700');
    while (tam > tamNombre * 0.78 && ctx.measureText(name).width > bw - sangria * 2) {
      tam -= 1;
      ctx.font = font(tam, '700');
    }
    ctx.fillText(recortar(ctx, name, bw - sangria * 2), bx + sangria, cy + 1);

    // La franja clara con el número grande, un poco más alta que la fila.
    const extra = Math.round(rowH * 0.09);
    ctx.save();
    ctx.shadowColor = 'rgba(30, 40, 60, 0.16)';
    ctx.shadowBlur = Math.round(rowH * 0.16);
    ctx.fillStyle = '#f7f8fb';
    ctx.fillRect(x0 + cuadro - 1, y0 - extra, franja + 2, rowH + extra * 2);
    ctx.restore();
    ctx.fillStyle = c.numero;
    ctx.font = font(Math.round(rowH * 0.46), '800');
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1).padStart(2, '0'), x0 + cuadro + franja / 2, cy + 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  });

  if (n === 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8a93a6';
    ctx.font = font(30, '500');
    ctx.fillText('Sin personas registradas', ANCHO / 2, yLista + altoLista / 2 + 10);
    ctx.textAlign = 'left';
  }

  pieApp(ctx, yPie, t, 'Hecho con Coordinación GEMB · Gimnasio Emocional Mentes Brillantes');
  return aPng(canvas);
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

export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded' | 'opened' | 'blocked' | 'error';

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
  // App de Android: su WebView no tiene el menú de compartir de la web.
  if (enAppAndroid) {
    try {
      await compartirArchivo(blob, filename, text);
      return 'shared';
    } catch (e) {
      // En la app no existe una cancelación que llegue aquí (el teléfono
      // responde apenas abre el menú): esto siempre es un error de verdad.
      console.error('No se pudo compartir desde la app', e);
      return 'error';
    }
  }
  const nav = navigator as Navigator & {
    canShare?: (d: unknown) => boolean;
    share?: (d: unknown) => Promise<void>;
  };
  try {
    // Sirve también para el PDF de la carpeta: el tipo sale del archivo.
    const file = new File([blob], filename, { type: blob.type || 'image/png' });
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

  // Si pasó mucho tiempo desde el toque (la imagen no estaba lista), el
  // navegador puede bloquear la ventana: entonces no se puede decir "se abrió".
  const ventana = window.open(url, '_blank');
  if (!ventana) {
    URL.revokeObjectURL(url);
    return 'blocked';
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'opened';
}
