import { MODALITY_LABELS, SESSION_TYPE_LABELS } from './constants';
import { NOMBRES_DIA, NOMBRES_MES, type FechaPlan } from './programacion';
import type { SessionType } from '../types';

// ---------------------------------------------------------------------------
//  El mensaje que acompaña la imagen de la coordinadora en el grupo de
//  WhatsApp (pedido del 19 oct 2026). Varios ya escritos y que van
//  cambiando, para que no salgan todos iguales: cada fecha arranca en uno
//  distinto y «Otro mensaje» pasa al siguiente. Si es virtual, lleva el
//  enlace de Meet.
// ---------------------------------------------------------------------------

type Datos = { cuando: string; reunion: string; hora: string; modalidad: string };

const PLANTILLAS: ((d: Datos) => string)[] = [
  (d) => `¡Hola, familia GEMB! 🌟 ${may(d.cuando)} los espero en ${d.reunion}, a las ${d.hora} (${d.modalidad}). ¡Será un gusto acompañarlos!`,
  (d) => `Bienvenidos ${d.cuando} a ${d.reunion} ✨ Nos vemos a las ${d.hora} (${d.modalidad}). ¡Los espero con mucho cariño!`,
  (d) => `¡${may(d.cuando)} tenemos encuentro! 💛 ${may(d.reunion)}, a las ${d.hora} (${d.modalidad}). Te espero.`,
  (d) => `Recordatorio con cariño: ${d.cuando} es ${d.reunion}, a las ${d.hora} (${d.modalidad}). ¡Allá nos vemos!`,
  (d) => `Te espero ${d.cuando} en ${d.reunion} 🙌 A las ${d.hora}, ${d.modalidad}. ¡No faltes!`,
  (d) => `¡Prepárate para ${d.cuando}! ${may(d.reunion)}, a las ${d.hora} (${d.modalidad}). Me alegra mucho acompañarte. 🌱`,
  (d) => `${may(d.cuando)} nos encontramos en ${d.reunion} 🤍 A las ${d.hora}, ${d.modalidad}. ¡Te espero con los brazos abiertos!`,
  (d) => `Querida familia: ${d.cuando} los acompaño en ${d.reunion}, a las ${d.hora} (${d.modalidad}). ¡Nos vemos allá! ✨`,
];

export const CUANTOS_MENSAJES = PLANTILLAS.length;

const may = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "5:30 PM - 6:45 PM" → "5:30 p. m." */
function horaDe(horario: string): string {
  const m = horario.match(/(\d{1,2}:\d{2})\s*(AM|PM)/i);
  if (!m) return horario || 'la hora de siempre';
  return `${m[1]} ${m[2].toUpperCase() === 'AM' ? 'a. m.' : 'p. m.'}`;
}

/**
 * El mensaje número `vuelta` (0 = el de esta fecha) para la reunión `tipo`
 * de la fecha `p`. `dias` es cuántos faltan: 0 dice «hoy», 1 «mañana» y más
 * adelante «el jueves 29 de octubre» (para mandarla con tiempo, 27 oct 2026).
 */
export function mensajeCoordina(
  p: FechaPlan,
  tipo: SessionType,
  opts: { dias: number; vuelta: number; enlace?: string; nombre?: string },
): string {
  const dia = `${NOMBRES_DIA[p.diaSemana].toLowerCase()} ${p.fecha.getUTCDate()} de ${NOMBRES_MES[
    p.fecha.getUTCMonth()
  ].toLowerCase()}`;
  const datos: Datos = {
    cuando: `${opts.dias === 0 ? 'hoy' : opts.dias === 1 ? 'mañana' : 'el'} ${dia}`,
    reunion: `la ${SESSION_TYPE_LABELS[tipo]}`,
    hora: horaDe(p.horario),
    modalidad: MODALITY_LABELS[p.modalidad].toLowerCase(),
  };
  // Cada fecha arranca en un mensaje distinto (según el día del año).
  const inicio = Math.floor(Date.UTC(p.fecha.getUTCFullYear(), p.fecha.getUTCMonth(), p.fecha.getUTCDate()) / 86_400_000);
  const i = (((inicio + opts.vuelta) % CUANTOS_MENSAJES) + CUANTOS_MENSAJES) % CUANTOS_MENSAJES;
  const partes = [PLANTILLAS[i](datos)];
  if (p.modalidad === 'virtual' && opts.enlace) partes.push(`👉 Entra por Meet: ${opts.enlace}`);
  if (opts.nombre) partes.push(`— ${opts.nombre}`);
  return partes.join('\n\n');
}

/**
 * La notificación del día antes (la manda el servidor a las 9 a. m.): corta,
 * porque el teléfono la recorta. Al tocarla se abre Asistencia, donde está la
 * tarjeta con la imagen y el mensaje.
 */
export function avisoDiaAntes(p: FechaPlan, tipo: SessionType): { titulo: string; cuerpo: string } {
  const dia = `${NOMBRES_DIA[p.diaSemana].toLowerCase()} ${p.fecha.getUTCDate()}`;
  return {
    titulo: 'Mañana coordinas tú ✨',
    cuerpo:
      `${SESSION_TYPE_LABELS[tipo]} · ${dia} · ${MODALITY_LABELS[p.modalidad].toLowerCase()}, ` +
      `${horaDe(p.horario)}. Toca aquí para mandar tu imagen al grupo.`,
  };
}

/** La de «Probar aviso»: para que vea cómo le va a llegar. */
export const AVISO_DE_PRUEBA = {
  titulo: '¡Listo! Así te llegará el aviso 🔔',
  cuerpo: 'El día antes de coordinar te aviso aquí, con tu imagen y el mensaje listos para el grupo.',
};
