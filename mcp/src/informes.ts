import { buildActivityReport, resumenActividad } from '../../src/lib/activity';
import { toDate, fmtDate, dayKey, daysFromToday } from '../../src/lib/dates';
import { buildFuse, searchMembers, toSearchable } from '../../src/lib/search';
import { SESSION_TYPE_LABELS, MODALITY_LABELS } from '../../src/lib/constants';
import type { Attendance, Member, Session, SessionType } from '../../src/types';
import type { MemberPublico } from './rest';

// ---------------------------------------------------------------------------
//  Los textos que devuelve cada herramienta del MCP.
//
//  Van aparte del servidor, sin tocar Firebase ni el protocolo, para poder
//  probarlos con datos armados a mano: es donde viven los errores de conteo
//  y de "me equivoqué de campo".
// ---------------------------------------------------------------------------

export type TipoCorto = 'pasos' | 'ego';

export const TIPOS: Record<TipoCorto, SessionType> = {
  pasos: 'entrega_pasos',
  ego: 'reduccion_ego',
};

/**
 * Reuniones que ya ocurrieron: las de hoy o antes, contando el día en Bogotá.
 * El servidor corre en UTC; con la hora de allá, a las 7 p. m. de Colombia ya
 * era "mañana" y la reunión del día siguiente contaba como hecha.
 */
function realizadas(sessions: Session[], hoy: Date) {
  const hoyKey = dayKey(hoy);
  return sessions.filter((s) => dayKey(s.date) <= hoyKey);
}

export function informeComoVamos(
  sessions: Session[],
  attendance: Attendance[],
  tipo: TipoCorto,
  ventana: number,
  conNombres: boolean,
  hoy: Date = new Date(),
): string {
  // El texto lo arma la app (src/lib/activity.ts), no este servidor: es el
  // mismo que produce el boton "Copiar resumen" del Panel, asi que Claude y
  // la pantalla no pueden decir cosas distintas.
  return resumenActividad(
    buildActivityReport(sessions, attendance, TIPOS[tipo], ventana, hoy),
    conNombres,
  );
}

export function informeConteos(
  sessions: Session[],
  personas: MemberPublico[],
  hoy: Date = new Date(),
): string {
  const hechas = realizadas(sessions, hoy);
  const porTipo = (t: SessionType) => hechas.filter((s) => s.type === t).length;
  // La lista oficial es la de la pantalla Personas: sin las fichas "por
  // revisar", que todavía no forman parte de ella.
  const oficiales = personas.filter((p) => !p.pendingReview);

  return [
    `Personas en la lista oficial: ${oficiales.filter((p) => p.active !== false).length} activas de ${oficiales.length}`,
    `Esperando revisión (agregadas en una reunión): ${personas.filter((p) => p.pendingReview).length}`,
    `Sin nombre todavía ("Por identificar"): ${personas.filter((p) => p.pendingIdentify).length}`,
    `Reuniones realizadas: ${hechas.length} (Pasos: ${porTipo('entrega_pasos')}, Ego: ${porTipo('reduccion_ego')})`,
    `Reuniones agendadas a futuro: ${sessions.length - hechas.length}`,
    `Sesiones abiertas ahora mismo: ${sessions.filter((s) => s.status === 'open').length}`,
  ].join('\n');
}

export function informeReuniones(
  sessions: Session[],
  attendance: Attendance[],
  tipo: TipoCorto | 'todas',
  limite: number,
  hoy: Date = new Date(),
): string {
  const presentes = new Map<string, number>();
  for (const a of attendance) {
    presentes.set(a.sessionId, (presentes.get(a.sessionId) ?? 0) + 1);
  }
  const delTipo = sessions
    .filter((s) => tipo === 'todas' || s.type === TIPOS[tipo])
    .sort((a, b) => toDate(b.date).getTime() - toDate(a.date).getTime());
  if (delTipo.length === 0) return 'No hay reuniones registradas.';

  // Primero las que ya ocurrieron (de la más reciente hacia atrás) y aparte las
  // agendadas: antes la próxima semana salía de primera y era fácil tomar su
  // id para pasar la lista de hoy.
  const hoyKey = dayKey(hoy);
  const hechas = delTipo.filter((s) => dayKey(s.date) <= hoyKey).slice(0, limite);
  const proximas = delTipo
    .filter((s) => dayKey(s.date) > hoyKey)
    .reverse()
    .slice(0, limite);

  const linea = (s: Session) => {
    const n = presentes.get(s.id) ?? 0;
    const futura = dayKey(s.date) > hoyKey;
    return (
      `${fmtDate(s.date)} · ${SESSION_TYPE_LABELS[s.type]} · ${MODALITY_LABELS[s.modality]} · ` +
      // Una reunión agendada saldría como "0 presentes", que se lee igual que
      // "no fue nadie". Y si ya tiene gente marcada, algo se marcó por error.
      (futura
        ? n > 0
          ? `⚠️ AGENDADA pero ya tiene ${n} presentes (¿se marcó en la reunión equivocada?)`
          : 'AGENDADA (todavía no ocurre)'
        : `${n} presentes`) +
      (s.coordinator ? ` · coordinó ${s.coordinator}` : '') +
      (s.status === 'open'
        ? daysFromToday(s.date, hoy) < -1
          ? ' · ⚠️ SIGUE ABIERTA (falta cerrarla)'
          : ' · ABIERTA'
        : '') +
      `\n  id: ${s.id}`
    );
  };

  return [
    ...(hechas.length ? ['Recientes:', ...hechas.map(linea)] : ['Todavía no hay reuniones realizadas.']),
    ...(proximas.length ? ['', 'Agendadas:', ...proximas.map(linea)] : []),
  ].join('\n');
}

export function informeAsistenciaReunion(
  s: Session | null,
  asistentes: Attendance[],
  reunionId: string,
): string {
  if (!s) return `No existe ninguna reunión con id ${reunionId}.`;

  const gente = [...asistentes].sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));

  return [
    `${SESSION_TYPE_LABELS[s.type]} — ${fmtDate(s.date)} · ${MODALITY_LABELS[s.modality]}` +
      (s.coordinator ? ` · coordinó ${s.coordinator}` : ''),
    `${gente.length} presentes:`,
    ...gente.map((a) => `  - ${a.fullName}`),
  ].join('\n');
}

/**
 * La MISMA búsqueda que el buscador de la app: mira también los alias
 * ("Rous" para Rosalba), tolera errores de tipeo y, si nadie coincide con
 * todas las palabras, ofrece las que fallan en una sola. Antes exigía cada
 * palabra exacta y, al no encontrar a alguien, se creaba una ficha repetida.
 */
export function informeBuscarPersona(personas: MemberPublico[], nombre: string): string {
  const todas = toSearchable(personas as Member[]);
  const encontradas = searchMembers(buildFuse(todas), todas, nombre, 25);

  if (encontradas.length === 0) {
    return (
      `Nadie coincide con "${nombre}". Antes de crear una ficha nueva, prueba ` +
      'con solo el primer nombre o solo el apellido.'
    );
  }

  return [
    ...(encontradas.partial
      ? [`Nadie coincide con todo "${nombre}". Estas personas coinciden en casi todo:`, '']
      : []),
    ...encontradas.map(
      (p) =>
        `${p.fullName}` +
        (p.aliases?.length ? ` (también: ${p.aliases.join(', ')})` : '') +
        (p.active === false ? ' (inactiva)' : '') +
        (p.pendingReview ? ' (esperando revisión)' : '') +
        (p.pendingIdentify ? ' (sin nombre confirmado)' : '') +
        `\n  id: ${p.id}`,
    ),
  ].join('\n');
}

export function informeHistorial(
  sessions: Session[],
  attendance: Attendance[],
  personas: MemberPublico[],
  personaId: string,
  hoy: Date = new Date(),
): string {
  const persona = personas.find((p) => p.id === personaId);
  const suyas = attendance
    .filter((a) => a.memberId === personaId)
    .sort((a, b) => toDate(b.sessionDate).getTime() - toDate(a.sessionDate).getTime());

  if (!persona && suyas.length === 0) {
    return `No existe ninguna persona con id ${personaId}.`;
  }
  const nombre = persona?.fullName ?? suyas[0]?.fullName ?? personaId;
  const cuenta = (t: SessionType) => suyas.filter((a) => a.sessionType === t).length;
  // El porcentaje se calcula desde su PRIMERA asistencia a ese tipo de
  // reunión: no tiene sentido contarle como faltas las reuniones de antes de
  // que llegara.
  const hechas = (t: SessionType) => {
    const propias = suyas.filter((a) => a.sessionType === t);
    if (propias.length === 0) return 0;
    const desde = dayKey(propias[propias.length - 1].sessionDate);
    return realizadas(sessions, hoy).filter((s) => s.type === t && dayKey(s.date) >= desde)
      .length;
  };
  const pct = (h: number, total: number) =>
    total > 0
      ? ` (${Math.round((Math.min(h, total) / total) * 100)}% de las ${total} desde que llegó)`
      : '';

  return [
    `${nombre}`,
    `Total de asistencias: ${suyas.length}`,
    `  Entrega de Pasos: ${cuenta('entrega_pasos')}${pct(cuenta('entrega_pasos'), hechas('entrega_pasos'))}`,
    `  Reducción del Ego: ${cuenta('reduccion_ego')}${pct(cuenta('reduccion_ego'), hechas('reduccion_ego'))}`,
    suyas.length ? `Última vez: ${fmtDate(suyas[0].sessionDate)}` : '',
    suyas.length ? `Primera vez: ${fmtDate(suyas[suyas.length - 1].sessionDate)}` : '',
    '',
    'Historial:',
    ...suyas.map(
      (a) =>
        `  ${fmtDate(a.sessionDate)} · ${SESSION_TYPE_LABELS[a.sessionType]} · ${MODALITY_LABELS[a.modality]}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Igual que la bandeja "Revisar" de la app: las fichas por revisar (se pueden
 * aprobar desde aquí). Aparte, las que ya están en la lista oficial pero
 * siguen sin nombre real: esas se corrigen en Personas, no se "aprueban".
 */
export function informePorRevisar(personas: MemberPublico[]): string {
  const ficha = (p: MemberPublico) =>
    `${p.fullName}` +
    (p.pendingIdentify ? ' (sin nombre confirmado)' : '') +
    (p.createdByName ? ` · la registró ${p.createdByName}` : '') +
    (p.sourceSessionDate ? ` · el ${fmtDate(p.sourceSessionDate)}` : '') +
    `\n  id: ${p.id}`;

  const porRevisar = personas.filter((p) => p.pendingReview);
  const sinNombre = personas.filter((p) => !p.pendingReview && p.pendingIdentify);
  if (porRevisar.length === 0 && sinNombre.length === 0) {
    return 'No hay nadie esperando revisión.';
  }

  return [
    porRevisar.length
      ? `Esperando revisión (${porRevisar.length}):`
      : 'No hay nadie esperando revisión.',
    ...porRevisar.map(ficha),
    ...(sinNombre.length
      ? [
          '',
          `Ya en la lista pero SIN nombre real (${sinNombre.length}) — se corrigen en la app, Personas → Editar:`,
          ...sinNombre.map(ficha),
        ]
      : []),
  ].join('\n');
}
