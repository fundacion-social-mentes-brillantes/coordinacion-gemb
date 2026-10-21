import { MODALITY_LABELS } from './constants';
import {
  ANCHO,
  MARGEN,
  ORO,
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
  rect,
  temaDeImagen,
  vidrio,
} from './imagenApp';
import { DIA_CORTO, NOMBRES_MES, hayReunion, nombreActividades, type FechaPlan } from './programacion';

/**
 * La imagen de la programación del mes, para mandarla al grupo de WhatsApp
 * (botón «Imagen» de Coordinación). Con el diseño de la app (imagenApp.ts) y
 * los colores del calendario de mes: verde si ya tiene coordinadora, rojo si
 * falta (20 oct 2026; antes era una tarjeta blanca con el logo viejo).
 */

const ROW_H = 128;
const GAP_FILAS = 16;
const VERDE: [number, number, number] = [48, 209, 88];
const ROJO: [number, number, number] = [255, 69, 58];
const GRIS: [number, number, number] = [148, 163, 184];

export async function buildProgramacionImage(y: number, m: number, plan: FechaPlan[]): Promise<Blob> {
  const t = temaDeImagen();
  const icono = await prepararImagenApp();

  const anchoUtil = ANCHO - MARGEN * 2;
  const yChips = 418;
  const yFilas = yChips + 56 + 40;
  const altoFilas = plan.length ? plan.length * (ROW_H + GAP_FILAS) - GAP_FILAS : 170;
  const yPie = yFilas + altoFilas + 76;
  const { canvas, ctx } = lienzo(yPie + 58);

  fondoApp(ctx, canvas.height, t);
  marcaApp(ctx, MARGEN, 60, icono, t);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = t.acento;
  ctx.font = font(23, '800');
  espaciado(ctx, 'PROGRAMACIÓN DEL MES', MARGEN + 2, 262, 5);
  ctx.fillStyle = t.fuerte;
  ctx.font = font(72, '800');
  ctx.fillText(recortar(ctx, `${NOMBRES_MES[m]} ${y}`, anchoUtil), MARGEN, 346);
  ctx.fillStyle = t.suave;
  ctx.font = font(30, '500');
  ctx.fillText('Reuniones del Gimnasio Emocional Mentes Brillantes', MARGEN, 392);

  // Píldoras: cuántas reuniones, cuántas tienen coordinadora y cuántas no.
  const reuniones = plan.filter(hayReunion);
  const asignadas = reuniones.filter((p) => p.coordinadora).length;
  const faltan = reuniones.length - asignadas;
  let x = MARGEN;
  x +=
    chip(ctx, `${reuniones.length} ${reuniones.length === 1 ? 'reunión' : 'reuniones'}`, x, yChips, {
      fondo: 'rgba(255, 255, 255, 0.1)',
      letra: t.fuerte,
      borde: 'rgba(255, 255, 255, 0.16)',
    }, 56) + 14;
  const conCoord = `${asignadas} con coordinadora`;
  ctx.font = font(25, '700');
  const anchoCon = ctx.measureText(conCoord).width + 48;
  x += chip(ctx, conCoord, x, yChips, { fondo: degradadoAcento(ctx, x, yChips, anchoCon, t), letra: t.sobreAcento }, 56) + 14;
  if (faltan > 0) {
    ctx.font = font(25, '700');
    const txt = `${faltan} sin coordinadora`;
    if (x + ctx.measureText(txt).width + 48 <= MARGEN + anchoUtil) {
      chip(ctx, txt, x, yChips, { fondo: 'rgba(255, 69, 58, 0.2)', letra: '#ffa49d', borde: 'rgba(255, 69, 58, 0.6)' }, 56);
    }
  }

  if (plan.length === 0) {
    vidrio(ctx, MARGEN, yFilas, anchoUtil, altoFilas, 34, t);
    ctx.textAlign = 'center';
    ctx.fillStyle = t.tenue;
    ctx.font = font(30, '500');
    ctx.fillText('No hay reuniones programadas este mes.', ANCHO / 2, yFilas + altoFilas / 2 + 10);
    ctx.textAlign = 'left';
  }

  let yRow = yFilas;
  for (const p of plan) {
    const activa = hayReunion(p);
    // El color del calendario de mes: verde con coordinadora, rojo sin ella.
    const estado = !activa ? GRIS : p.coordinadora ? VERDE : ROJO;
    vidrio(ctx, MARGEN, yRow, anchoUtil, ROW_H, 30, t);

    // La fecha, en su cuadrito con el color del estado.
    const bx = MARGEN + 20;
    const by = yRow + 16;
    const bs = ROW_H - 32;
    rect(ctx, bx, by, bs, bs, 22);
    ctx.fillStyle = `rgba(${estado.join(', ')}, ${activa ? 0.16 : 0.1})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${estado.join(', ')}, ${activa ? 0.7 : 0.35})`;
    ctx.lineWidth = 2.5;
    rect(ctx, bx + 1, by + 1, bs - 2, bs - 2, 21);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = activa ? t.suave : t.tenue;
    ctx.font = font(19, '800');
    ctx.fillText(DIA_CORTO[p.diaSemana], bx + bs / 2, by + 32);
    ctx.fillStyle = activa ? t.fuerte : t.tenue;
    ctx.font = font(40, '800');
    ctx.fillText(String(p.fecha.getUTCDate()), bx + bs / 2, by + 76);
    ctx.textAlign = 'left';

    const tx = bx + bs + 26;
    const maxTx = MARGEN + anchoUtil - tx - 26;
    ctx.globalAlpha = activa ? 1 : 0.7;
    ctx.fillStyle = t.fuerte;
    ctx.font = font(31, '700');
    ctx.fillText(recortar(ctx, nombreActividades(p.actividades), maxTx), tx, yRow + 56);

    ctx.font = font(24, '500');
    if (p.festivo) {
      ctx.fillStyle = '#f2c98a';
      ctx.fillText(recortar(ctx, `Festivo · ${p.festivo}`, maxTx), tx, yRow + 94);
    } else if (p.cancelada) {
      ctx.fillStyle = '#ffa49d';
      ctx.fillText(recortar(ctx, `No hay reunión${p.motivo ? ` · ${p.motivo}` : ''}`, maxTx), tx, yRow + 94);
    } else {
      ctx.fillStyle = t.suave;
      const base = `${p.horario ? `${p.horario} · ` : ''}${MODALITY_LABELS[p.modalidad]} · `;
      const baseCorta = recortar(ctx, base, maxTx * 0.62);
      ctx.fillText(baseCorta, tx, yRow + 94);
      const bw = ctx.measureText(baseCorta).width;
      ctx.font = font(24, '700');
      ctx.fillStyle = p.coordinadora ? ORO : '#ff8a80';
      ctx.fillText(recortar(ctx, p.coordinadora || 'Sin coordinadora', maxTx - bw), tx + bw, yRow + 94);
    }
    ctx.globalAlpha = 1;
    yRow += ROW_H + GAP_FILAS;
  }

  pieApp(ctx, yPie, t, 'coordinacion-gemb.vercel.app/calendario · Gimnasio Emocional Mentes Brillantes');
  return aPng(canvas);
}

export const programacionImageName = (y: number, m: number) =>
  `programacion-${NOMBRES_MES[m].toLowerCase()}-${y}.png`;
