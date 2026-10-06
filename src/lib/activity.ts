import type { Attendance, Session, SessionType } from '../types';
import { dayKey, endOfTodayBogota, toDate, fmtDate } from './dates';
import { SESSION_TYPE_LABELS, MODALITY_LABELS } from './constants';

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
  /**
   * ¿Tiene sentido comparar `activas` con `activasPrevias`? Solo si los dos
   * períodos tienen el mismo número de reuniones: 45 personas en 8 reuniones
   * contra 25 en 2 no es "20 más".
   */
  activasComparables: boolean;
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
  // "Hoy" en Bogotá, aunque esto corra en el servidor del MCP (UTC): allí el
  // día cambiaba a las 7 p. m. de Colombia y la reunión de mañana contaba
  // como hecha.
  const finDeHoy = endOfTodayBogota(hoy).getTime() - 1;

  // Quiénes vinieron a cada sesión (solo asistencia de reuniones que YA
  // ocurrieron: lo marcado por error en una sesión agendada no cuenta).
  const presentesDe = new Map<string, Set<string>>();
  for (const a of attendance) {
    if (a.sessionType !== type) continue;
    if (toDate(a.sessionDate).getTime() > finDeHoy) continue;
    let set = presentesDe.get(a.sessionId);
    if (!set) presentesDe.set(a.sessionId, (set = new Set()));
    set.add(a.memberId);
  }

  // Una REUNIÓN es un día: si quedaron dos sesiones del mismo tipo el mismo
  // día (duplicadas), cuentan como una sola, juntando su gente. Y una sesión
  // sin nadie no es una reunión hecha (la de hoy antes de empezar, o la
  // duplicada vacía): antes bajaban el promedio y desplazaban de la ventana
  // a una reunión real.
  const porDia = new Map<string, { session: Session; ids: Set<string>; gente: Set<string> }>();
  for (const s of sessions) {
    if (s.type !== type || toDate(s.date).getTime() > finDeHoy) continue;
    const gente = presentesDe.get(s.id);
    if (!gente || gente.size === 0) continue;
    const k = dayKey(s.date);
    const r = porDia.get(k);
    if (!r) {
      porDia.set(k, { session: s, ids: new Set([s.id]), gente: new Set(gente) });
    } else {
      r.ids.add(s.id);
      gente.forEach((m) => r.gente.add(m));
      // La que representa al día es la que más gente tiene.
      if (gente.size > (presentesDe.get(r.session.id)?.size ?? 0)) r.session = s;
    }
  }
  const realizadas = [...porDia.values()].sort(
    (a, b) => toDate(b.session.date).getTime() - toDate(a.session.date).getTime(),
  );

  const recientesS = realizadas.slice(0, ventana);
  const previasS = realizadas.slice(ventana, ventana * 2);
  // sessionId → día de la reunión, en cada ventana.
  const diaReciente = new Map<string, string>();
  const diaPrevio = new Map<string, string>();
  for (const r of recientesS) r.ids.forEach((id) => diaReciente.set(id, dayKey(r.session.date)));
  for (const r of previasS) r.ids.forEach((id) => diaPrevio.set(id, dayKey(r.session.date)));

  const mapa = new Map<string, PersonActivity & { _rec: Set<string>; _prev: Set<string> }>();

  for (const a of attendance) {
    if (a.sessionType !== type) continue;
    const fecha = toDate(a.sessionDate);
    // Una asistencia en una reunión que todavía no ocurre no puede ser su
    // "última vez" ni cambiar su grupo.
    if (fecha.getTime() > finDeHoy) continue;

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
        _rec: new Set(),
        _prev: new Set(),
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

    // Por DÍA de reunión: estar en las dos sesiones duplicadas de un mismo
    // día es una sola asistencia.
    const dr = diaReciente.get(a.sessionId);
    const dp = diaPrevio.get(a.sessionId);
    if (dr) p._rec.add(dr);
    else if (dp) p._prev.add(dp);
  }
  for (const p of mapa.values()) {
    p.recientes = p._rec.size;
    p.previas = p._prev.size;
  }

  // "Firme" = vino al 60% o más de las reuniones de la ventana (mínimo 1).
  const umbralFirmes = Math.max(1, Math.ceil(recientesS.length * 0.6));

  // Frontera de la ventana: quien no tiene NINGUNA asistencia anterior a esta
  // fecha se estrenó dentro del período.
  const inicioVentana = recientesS.length
    ? toDate(recientesS[recientesS.length - 1].session.date).getTime()
    : null;

  // "Nueva" no puede significar solo "su primera vez cae en la ventana": con
  // una ventana larga, alguien que vino dos veces hace dos meses y no volvió
  // saldría anunciada como nueva. Se exige además que siga apareciendo, o
  // sea, que su última vez esté en la mitad más reciente del período.
  const inicioMitad = recientesS.length
    ? toDate(
        recientesS[Math.ceil(recientesS.length / 2) - 1].session.date,
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

  const personas: PersonActivity[] = [...mapa.values()]
    .map(({ _rec: _r, _prev: _p, ...p }) => p)
    .sort(
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
    recientes: [...recientesS].reverse().map((r) => ({
      session: r.session,
      presentes: r.gente.size,
    })),
    previasCount: previasS.length,
    desde: recientesS.length ? toDate(recientesS[recientesS.length - 1].session.date) : null,
    hasta: recientesS.length ? toDate(recientesS[0].session.date) : null,
    activas,
    activasPrevias,
    activasComparables: previasS.length > 0 && previasS.length === recientesS.length,
    promedio: recientesS.length ? totalRec / recientesS.length : 0,
    promedioPrevio: previasS.length ? totalPrev / previasS.length : 0,
    umbralFirmes,
    puedeDetectarNuevas,
    personas,
    grupos,
  };
}

// ---------------------------------------------------------------------------
//  El mismo informe, en texto plano.
//
//  Lo usan el boton "Copiar resumen" de la app y el servidor MCP, para que
//  digan exactamente lo mismo: si algun dia cambia una cifra o una etiqueta,
//  cambia en los dos a la vez.
// ---------------------------------------------------------------------------

const GRUPO_TITULO: Record<ActivityGroup, string> = {
  firmes: 'Firmes',
  nuevas: 'Nuevas',
  irregulares: 'Van y vienen',
  alejandose: 'Se están alejando',
  dormidas: 'Hace rato no vienen',
};

export function resumenActividad(r: ActivityReport, conNombres = true): string {
  if (r.recientes.length === 0) {
    return `Todavía no hay reuniones registradas de ${SESSION_TYPE_LABELS[r.type]}.`;
  }

  const n = r.recientes.length;
  const cmp = (actual: number, previo: number) => {
    if (r.previasCount === 0) return ' (no hay período anterior con qué comparar)';
    const d = Math.round((actual - previo) * 10) / 10;
    if (d === 0) return ' (igual que en el período anterior)';
    return ` (${d > 0 ? '+' : ''}${d} frente al período anterior)`;
  };

  const lineas = [
    `${SESSION_TYPE_LABELS[r.type]} — últimas ${n} reuniones (${fmtDate(r.desde)} a ${fmtDate(r.hasta)})`,
    '',
    `PERSONAS DISTINTAS QUE VINIERON: ${r.activas}${
      r.activasComparables || r.previasCount === 0
        ? cmp(r.activas, r.activasPrevias)
        : ` (el período anterior solo tuvo ${r.previasCount} reunión(es): no es comparable)`
    }`,
    `Promedio de presentes por reunión: ${Math.round(r.promedio * 10) / 10}${cmp(
      r.promedio,
      r.promedioPrevio,
    )}`,
    '',
    'Grupos:',
    `  Firmes (vinieron ${r.umbralFirmes}+ de ${n}): ${r.grupos.firmes}`,
    `  Nuevas (primera vez y siguen viniendo): ${r.grupos.nuevas}${
      r.puedeDetectarNuevas ? '' : ' — sin historial anterior, no se puede saber'
    }`,
    `  Van y vienen: ${r.grupos.irregulares}`,
    `  Se están alejando (venían antes, ahora no): ${r.grupos.alejandose}`,
    `  Hace rato no vienen: ${r.grupos.dormidas}`,
    '',
    'Asistentes por reunión:',
    ...r.recientes.map(
      ({ session, presentes }) =>
        `  ${fmtDate(session.date)} (${MODALITY_LABELS[session.modality]}): ${presentes}`,
    ),
  ];

  if (conNombres) {
    for (const g of ['firmes', 'nuevas', 'irregulares', 'alejandose'] as ActivityGroup[]) {
      const gente = r.personas.filter((p) => p.grupo === g);
      if (gente.length === 0) continue;
      lineas.push('', `${GRUPO_TITULO[g]}:`);
      for (const p of gente) {
        lineas.push(
          p.recientes > 0
            ? `  - ${p.fullName} — vino ${p.recientes} de ${n}`
            : `  - ${p.fullName} — última vez ${fmtDate(p.ultima)}`,
        );
      }
    }
  }

  return lineas.join('\n');
}
