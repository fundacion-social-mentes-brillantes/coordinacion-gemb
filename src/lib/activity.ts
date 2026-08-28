import type { Attendance, Session, SessionType } from '../types';
import { toDate } from './dates';

// ---------------------------------------------------------------------------
//  ¿Quiénes están viniendo últimamente?
// ---------------------------------------------------------------------------
//  El Panel responde "cuánto hubo en el año". Esto responde otra pregunta,
//  la que se hace la coordinación en el día a día: de las personas que
//  asisten, ¿cuántas siguen viniendo AHORA, cuántas son nuevas y cuántas se
//  están alejando?
//
//  La ventana se mide en REUNIONES, no en días: si hubo vacaciones o se saltó
//  una semana, "las últimas 4 reuniones" sigue significando algo; "los últimos
//  30 días" podría quedar vacío y dar un susto falso.
// ---------------------------------------------------------------------------

export type ActivityGroup =
  | 'nuevas'
  | 'firmes'
  | 'irregulares'
  | 'alejandose'
  | 'dormidas';

export interface PersonActivity {
  memberId: string;
  fullName: string;
  /** Asistencias dentro de la ventana reciente. */
  recientes: number;
  /** Asistencias en la ventana inmediatamente anterior (para comparar). */
  previas: number;
  /** Primera vez que vino a este tipo de reunión (de todo su historial). */
  primera: Date;
  /** Última vez que vino a este tipo de reunión. */
  ultima: Date;
  grupo: ActivityGroup;
}

export interface SessionCount {
  session: Session;
  presentes: number;
}

export interface ActivityReport {
  type: SessionType;
  /** Reuniones pedidas por ventana (4, 8, 12…). */
  ventana: number;
  /** Reuniones de la ventana reciente, de la más antigua a la más nueva. */
  recientes: SessionCount[];
  /** Cuántas reuniones tiene la ventana anterior (puede ser 0 al principio). */
  previasCount: number;
  desde: Date | null;
  hasta: Date | null;
  /** LA CIFRA: personas distintas que vinieron al menos una vez. */
  activas: number;
  activasPrevias: number;
  /** Promedio de presentes por reunión. */
  promedio: number;
  promedioPrevio: number;
  /** Asistencias necesarias para considerar a alguien "firme". */
  umbralFirmes: number;
  /**
   * false = no hay reuniones anteriores con qué comparar, así que no se puede
   * afirmar que alguien sea "nueva" (al estrenar la app, TODAS lo parecerían).
   */
  puedeDetectarNuevas: boolean;
  /** Todas las personas con historial en este tipo de reunión. */
  personas: PersonActivity[];
  grupos: Record<ActivityGroup, number>;
}

const GROUP_ORDER: ActivityGroup[] = [
  'firmes',
  'nuevas',
  'irregulares',
  'alejandose',
  'dormidas',
];

/**
 * Arma el informe de actividad reciente para un tipo de reunión.
 *
 * @param sessions   Todas las reuniones (sin filtrar por año).
 * @param attendance Toda la asistencia (sin filtrar por año): hace falta el
 *                   historial completo para saber quién es realmente nueva.
 * @param type       'entrega_pasos' o 'reduccion_ego'.
 * @param ventana    Cuántas reuniones mirar hacia atrás.
 * @param hoy        Inyectable para poder probarlo con fechas fijas.
 */
export function buildActivityReport(
  sessions: Session[],
  attendance: Attendance[],
  type: SessionType,
  ventana: number,
  hoy: Date = new Date(),
): ActivityReport {
  const finDeHoy = new Date(
    hoy.getFullYear(),
    hoy.getMonth(),
    hoy.getDate(),
    23,
    59,
    59,
    999,
  ).getTime();

  // Solo reuniones de este tipo que YA ocurrieron: una reunión agendada para
  // la próxima semana no debe bajar el promedio de presentes.
  const realizadas = sessions
    .filter((s) => s.type === type && toDate(s.date).getTime() <= finDeHoy)
    .sort((a, b) => toDate(b.date).getTime() - toDate(a.date).getTime());

  const recientesS = realizadas.slice(0, ventana);
  const previasS = realizadas.slice(ventana, ventana * 2);
  const idsRecientes = new Set(recientesS.map((s) => s.id));
  const idsPrevias = new Set(previasS.map((s) => s.id));

  const mapa = new Map<string, PersonActivity>();
  const presentesPorSesion = new Map<string, number>();

  for (const a of attendance) {
    if (a.sessionType !== type) continue;
    const fecha = toDate(a.sessionDate);

    let p = mapa.get(a.memberId);
    if (!p) {
      p = {
        memberId: a.memberId,
        fullName: a.fullName,
        recientes: 0,
        previas: 0,
        primera: fecha,
        ultima: fecha,
        grupo: 'dormidas',
      };
      mapa.set(a.memberId, p);
    }
    // Se queda el nombre más reciente: las fichas "Por identificar" se
    // corrigen después, y el registro viejo conserva el nombre provisional.
    if (fecha.getTime() >= p.ultima.getTime()) {
      p.ultima = fecha;
      p.fullName = a.fullName;
    }
    if (fecha.getTime() < p.primera.getTime()) p.primera = fecha;

    if (idsRecientes.has(a.sessionId)) {
      p.recientes++;
      presentesPorSesion.set(
        a.sessionId,
        (presentesPorSesion.get(a.sessionId) ?? 0) + 1,
      );
    } else if (idsPrevias.has(a.sessionId)) {
      p.previas++;
    }
  }

  // "Firme" = vino al 60% o más de las reuniones de la ventana (mínimo 1).
  const umbralFirmes = Math.max(1, Math.ceil(recientesS.length * 0.6));

  // Frontera de la ventana: quien no tiene NINGUNA asistencia anterior a esta
  // fecha se estrenó dentro del período.
  const inicioVentana = recientesS.length
    ? toDate(recientesS[recientesS.length - 1].date).getTime()
    : null;

  // "Nueva" no puede significar solo "su primera vez cae en la ventana": con
  // una ventana larga, alguien que vino dos veces hace dos meses y no volvió
  // saldría anunciada como nueva. Se exige además que siga apareciendo, o
  // sea, que su última vez esté en la mitad más reciente del período.
  const inicioMitad = recientesS.length
    ? toDate(
        recientesS[Math.ceil(recientesS.length / 2) - 1].date,
      ).getTime()
    : null;

  // Sin reuniones anteriores no hay con qué contrastar: nadie se marca como
  // "nueva" (si no, al estrenar la app todo el mundo saldría estrenándose).
  const puedeDetectarNuevas = previasS.length > 0;

  const grupos: Record<ActivityGroup, number> = {
    nuevas: 0,
    firmes: 0,
    irregulares: 0,
    alejandose: 0,
    dormidas: 0,
  };

  for (const p of mapa.values()) {
    if (p.recientes > 0) {
      if (
        puedeDetectarNuevas &&
        inicioVentana !== null &&
        inicioMitad !== null &&
        p.primera.getTime() >= inicioVentana &&
        p.ultima.getTime() >= inicioMitad
      ) {
        p.grupo = 'nuevas';
      } else if (p.recientes >= umbralFirmes) {
        p.grupo = 'firmes';
      } else {
        p.grupo = 'irregulares';
      }
    } else if (p.previas > 0) {
      p.grupo = 'alejandose';
    } else {
      p.grupo = 'dormidas';
    }
    grupos[p.grupo]++;
  }

  const personas = [...mapa.values()].sort(
    (a, b) =>
      GROUP_ORDER.indexOf(a.grupo) - GROUP_ORDER.indexOf(b.grupo) ||
      b.recientes - a.recientes ||
      b.ultima.getTime() - a.ultima.getTime() ||
      a.fullName.localeCompare(b.fullName, 'es'),
  );

  let totalRec = 0;
  let totalPrev = 0;
  let activas = 0;
  let activasPrevias = 0;
  for (const p of personas) {
    totalRec += p.recientes;
    totalPrev += p.previas;
    if (p.recientes > 0) activas++;
    if (p.previas > 0) activasPrevias++;
  }

  return {
    type,
    ventana,
    // De la más antigua a la más nueva: así se lee la tendencia de izquierda
    // a derecha, como en el gráfico por mes del resumen.
    recientes: [...recientesS].reverse().map((session) => ({
      session,
      presentes: presentesPorSesion.get(session.id) ?? 0,
    })),
    previasCount: previasS.length,
    desde: recientesS.length ? toDate(recientesS[recientesS.length - 1].date) : null,
    hasta: recientesS.length ? toDate(recientesS[0].date) : null,
    activas,
    activasPrevias,
    promedio: recientesS.length ? totalRec / recientesS.length : 0,
    promedioPrevio: previasS.length ? totalPrev / previasS.length : 0,
    umbralFirmes,
    puedeDetectarNuevas,
    personas,
    grupos,
  };
}
