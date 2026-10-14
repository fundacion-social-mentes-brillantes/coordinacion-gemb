import { MODALITY_LABELS } from './constants';
import { drawChip, ellipsize, font, preloadLogo, roundRect } from './shareImage';
import {
  DIA_CORTO,
  NOMBRES_MES,
  hayReunion,
  nombreActividades,
  type FechaPlan,
} from './programacion';

/**
 * La imagen de la programación del mes, para mandarla al grupo de WhatsApp
 * (lo que hacía el botón "Imagen" del Calendario viejo). Mismos colores que
 * el Calendario: azul noche y dorado. Canvas nativo, sin librerías.
 */

const W = 1080;
const PAD = 48;
const ROW_H = 132;
const NAVY = '#102a56';
const NAVY_2 = '#1d3f7a';
const GOLD = '#d6b55e';
const SOFT = '#f7f1de';

export async function buildProgramacionImage(y: number, m: number, plan: FechaPlan[]): Promise<Blob> {
  const cardX = PAD;
  const cardW = W - PAD * 2;
  const headerH = 300;
  const listH = Math.max(1, plan.length) * ROW_H + 40;
  const footerH = 96;
  const cardH = headerH + listH + footerH;
  const H = cardH + PAD * 2;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar la imagen.');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, SOFT);
  bg.addColorStop(1, '#ffffff');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.shadowColor = 'rgba(10, 20, 35, 0.18)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, cardX, PAD, cardW, cardH, 44);
  ctx.fill();
  ctx.restore();

  // Cabecera azul noche.
  ctx.save();
  roundRect(ctx, cardX, PAD, cardW, cardH, 44);
  ctx.clip();
  const hg = ctx.createLinearGradient(cardX, PAD, cardX + cardW, PAD + headerH);
  hg.addColorStop(0, NAVY);
  hg.addColorStop(1, NAVY_2);
  ctx.fillStyle = hg;
  ctx.fillRect(cardX, PAD, cardW, headerH);
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(cardX + cardW - 70, PAD + 40, 200, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const logo = await preloadLogo();
  const logoS = 92;
  const logoX = cardX + 52;
  const logoY = PAD + 52;
  ctx.save();
  ctx.beginPath();
  ctx.arc(logoX + logoS / 2, logoY + logoS / 2, logoS / 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fill();
  ctx.clip();
  if (logo) ctx.drawImage(logo, logoX, logoY, logoS, logoS);
  ctx.restore();

  const textX = logoX + logoS + 28;
  const textMaxW = cardX + cardW - textX - 52;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(246,228,176,0.82)';
  ctx.font = font(25, '600');
  ctx.fillText('PROGRAMACIÓN', textX, PAD + 88);
  ctx.fillStyle = '#f6e4b0';
  ctx.font = font(56, '800');
  ctx.fillText(ellipsize(ctx, `${NOMBRES_MES[m]} ${y}`, textMaxW), textX, PAD + 148);
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.font = font(27, '500');
  ctx.fillText(ellipsize(ctx, 'Gimnasio Emocional Mentes Brillantes', textMaxW), textX, PAD + 192);

  const reuniones = plan.filter(hayReunion);
  const asignadas = reuniones.filter((p) => p.coordinadora).length;
  let chipX = textX;
  chipX +=
    drawChip(ctx, `${reuniones.length} reuniones`, chipX, PAD + 220, {
      bg: 'rgba(255,255,255,0.18)',
      fg: '#ffffff',
    }) + 14;
  drawChip(ctx, `${asignadas} con coordinadora`, chipX, PAD + 220, { bg: GOLD, fg: NAVY });

  // Filas.
  let yRow = PAD + headerH + 20;
  if (plan.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = font(30, '500');
    ctx.fillText('No hay reuniones programadas este mes.', cardX + 52, yRow + 70);
  }
  for (const p of plan) {
    const activa = hayReunion(p);
    const x = cardX + 32;
    const w = cardW - 64;
    ctx.fillStyle = activa ? '#f8fafc' : '#f1f5f9';
    roundRect(ctx, x, yRow + 8, w, ROW_H - 16, 26);
    ctx.fill();

    // Bloque de fecha.
    ctx.fillStyle = activa ? NAVY : '#94a3b8';
    roundRect(ctx, x + 16, yRow + 22, 96, ROW_H - 44, 20);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = activa ? GOLD : '#e2e8f0';
    ctx.font = font(20, '700');
    ctx.fillText(DIA_CORTO[p.diaSemana], x + 64, yRow + 52);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(40, '800');
    ctx.fillText(String(p.fecha.getUTCDate()), x + 64, yRow + 94);
    ctx.textAlign = 'left';

    const tx = x + 136;
    const maxTx = x + w - tx - 24;
    ctx.fillStyle = activa ? '#0f172a' : '#64748b';
    ctx.font = font(30, '700');
    ctx.fillText(ellipsize(ctx, nombreActividades(p.actividades), maxTx), tx, yRow + 56);

    ctx.font = font(24, '500');
    if (p.festivo) {
      ctx.fillStyle = '#b45309';
      ctx.fillText(ellipsize(ctx, `Festivo · ${p.festivo}`, maxTx), tx, yRow + 94);
    } else if (p.cancelada) {
      ctx.fillStyle = '#b91c1c';
      ctx.fillText(
        ellipsize(ctx, `No hay reunión${p.motivo ? ` · ${p.motivo}` : ''}`, maxTx),
        tx,
        yRow + 94,
      );
    } else {
      ctx.fillStyle = '#475569';
      const base = `${p.horario} · ${MODALITY_LABELS[p.modalidad]} · `;
      ctx.fillText(base, tx, yRow + 94);
      const bw = ctx.measureText(base).width;
      ctx.fillStyle = p.coordinadora ? NAVY : '#16a34a';
      ctx.font = font(24, '700');
      ctx.fillText(
        ellipsize(ctx, p.coordinadora || 'Disponible', maxTx - bw),
        tx + bw,
        yRow + 94,
      );
    }
    yRow += ROW_H;
  }

  // Pie.
  ctx.fillStyle = '#94a3b8';
  ctx.font = font(22, '500');
  ctx.textAlign = 'center';
  ctx.fillText('coordinacion-gemb.vercel.app/calendario', W / 2, PAD + cardH - 40);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo crear la imagen.'))), 'image/png'),
  );
}

export const programacionImageName = (y: number, m: number) =>
  `programacion-${NOMBRES_MES[m].toLowerCase()}-${y}.png`;
