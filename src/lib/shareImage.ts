import type { Modality, SessionType } from '../types';
import { SESSION_TYPE_LABELS, MODALITY_LABELS } from './constants';
import {
  ANCHO,
  MARGEN,
  ORO,
  TONO_AZUL,
  TONO_VINO,
  aPng,
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
 * fondo de la app, ícono, marca, vidrio y el color de cada reunión.
 */

const ROW_H = 78;
const TWO_COL_FROM = 22; // a partir de tantos nombres, dos columnas
/**
 * Alto máximo de la zona de nombres. Safari en iPhone deja el lienzo en
 * blanco si la imagen se pasa de unos 4.000 px de alto, así que a partir de
 * cierta cantidad de gente se reparte en más columnas en vez de crecer.
 */
const MAX_LIST_H = 3000;
const MAX_COLS = 4;

/** Cada reunión con su color, como en «Para la reunión». */
const TONOS: Record<SessionType, Tono> = {
  entrega_pasos: TONO_VINO,
  reduccion_ego: TONO_AZUL,
};

/** El azul claro de las bolitas con el número (las dos reuniones). */
const AZUL_BOLITA: [number, number, number] = [104, 186, 255];

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
  // Columnas: 1 normalmente, 2 con mucha gente y más si aun así sería
  // demasiado alta (el iPhone no dibuja lienzos gigantes).
  let cols = names.length > TWO_COL_FROM ? 2 : 1;
  while (cols < MAX_COLS && Math.ceil(names.length / cols) * ROW_H > MAX_LIST_H) cols++;
  const rowsPerCol = Math.max(1, Math.ceil(names.length / cols));
  // Si ni con las columnas cabe, se aprietan un poco las filas.
  const rowH = Math.max(44, Math.min(ROW_H, MAX_LIST_H / rowsPerCol));

  const t = temaDeImagen();
  const tono = TONOS[data.type];
  const icono = await prepararImagenApp();

  const anchoUtil = ANCHO - MARGEN * 2;
  const yChips = 428;
  const altoChip = 56;
  const altoCoord = 118;
  const yCoord = yChips + altoChip + 34;
  const yLista = data.coordinator ? yCoord + altoCoord + 22 : yCoord;
  const padLista = 28;
  const altoLista = names.length ? rowsPerCol * rowH + padLista * 2 : 170;
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

  // --- La lista ---
  vidrio(ctx, MARGEN, yLista, anchoUtil, altoLista, 34, t);
  const listX = MARGEN + 28;
  const listW = anchoUtil - 56;
  const GAP = 30;
  const colW = (listW - GAP * (cols - 1)) / cols;
  const r = Math.min(24, Math.round(rowH * 0.31));
  const tamNombre = Math.min(cols === 1 ? 32 : cols === 2 ? 27 : cols === 3 ? 23 : 20, Math.round(rowH * 0.42));

  for (let c = 1; c < cols; c++) {
    const lx = listX + c * (colW + GAP) - GAP / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx, yLista + padLista);
    ctx.lineTo(lx, yLista + altoLista - padLista);
    ctx.stroke();
  }

  names.forEach((name, i) => {
    const col = Math.floor(i / rowsPerCol);
    const fila = i % rowsPerCol;
    const x0 = listX + col * (colW + GAP);
    const y0 = yLista + padLista + fila * rowH;
    const cy = y0 + rowH / 2;

    // El número en una bolita de vidrio azul claro, en las dos reuniones
    // (pedido del 20 oct 2026): translúcida, con su borde de luz.
    const g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    g.addColorStop(0, rgba(AZUL_BOLITA, 0.78));
    g.addColorStop(1, rgba(AZUL_BOLITA, 0.5));
    ctx.beginPath();
    ctx.arc(x0 + r, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(190, 224, 255, 0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = font(Math.round(r * 0.9), '700');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x0 + r, cy + 1);

    ctx.textAlign = 'left';
    ctx.fillStyle = t.fuerte;
    ctx.font = font(tamNombre, '600');
    const nx = x0 + r * 2 + 20;
    ctx.fillText(recortar(ctx, name, colW - (nx - x0) - 6), nx, cy + 1);
    ctx.textBaseline = 'alphabetic';

    // Una línea fina entre renglones (no después del último de la columna).
    if (fila < rowsPerCol - 1 && i + 1 < names.length) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(nx, y0 + rowH);
      ctx.lineTo(x0 + colW, y0 + rowH);
      ctx.stroke();
    }
  });

  if (names.length === 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = t.tenue;
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
