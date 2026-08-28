import { buildActivityReport, type ActivityGroup } from '../../src/lib/activity';
import { toDate, fmtDate } from '../../src/lib/dates';
import { normalizeText } from '../../src/lib/normalize';
import { SESSION_TYPE_LABELS, MODALITY_LABELS } from '../../src/lib/constants';
import type { Attendance, Session, SessionType } from '../../src/types';
import type { MemberPublico } from './firestore';

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

const GRUPO_TITULO: Record<ActivityGroup, string> = {
  firmes: 'Firmes',
  nuevas: 'Nuevas',
  irregulares: 'Van y vienen',
  alejandose: 'Se están alejando',
  dormidas: 'Hace rato no vienen',
};

/** Reuniones que ya ocurrieron a la fecha dada. */
function realizadas(sessions: Session[], hoy: Date) {
  const t = hoy.getTime();
  return sessions.filter((s) => toDate(s.date).getTime() <= t);
}

export function informeComoVamos(
  sessions: Session[],
  attendance: Attendance[],
  tipo: TipoCorto,
  ventana: number,
  conNombres: boolean,
  hoy: Date = new Date(),
): string {
  const type = TIPOS[tipo];
  const r = buildActivityReport(sessions, attendance, type, ventana, hoy);

  if (r.recientes.length === 0) {
    return `Todavía no hay reuniones registradas de ${SESSION_TYPE_LABELS[type]}.`;
  }

  const n = r.recientes.length;
  const cmp = (actual: number, previo: number) => {
    if (r.previasCount === 0) return ' (no hay período anterior con qué comparar)';
    const d = Math.round((actual - previo) * 10) / 10;
    if (d === 0) return ' (igual que en el período anterior)';
    return ` (${d > 0 ? '+' : ''}${d} frente al período anterior)`;
  };

  const lineas = [
    `${SESSION_TYPE_LABELS[type]} — últimas ${n} reuniones (${fmtDate(r.desde)} a ${fmtDate(r.hasta)})`,
    '',
    `PERSONAS DISTINTAS QUE VINIERON: ${r.activas}${cmp(r.activas, r.activasPrevias)}`,
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

export function informeConteos(
  sessions: Session[],
  personas: MemberPublico[],
  hoy: Date = new Date(),
): string {
  const hechas = realizadas(sessions, hoy);
  const porTipo = (t: SessionType) => hechas.filter((s) => s.type === t).length;

  return [
    `Personas en la lista: ${personas.filter((p) => p.active !== false).length} activas de ${personas.length}`,
    `Esperando revisión (walk-ins): ${personas.filter((p) => p.pendingReview).length}`,
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
  const lista = sessions
    .filter((s) => tipo === 'todas' || s.type === TIPOS[tipo])
    .sort((a, b) => toDate(b.date).getTime() - toDate(a.date).getTime())
    .slice(0, limite);

  if (lista.length === 0) return 'No hay reuniones registradas.';

  return lista
    .map((s) => {
      // Una reunión agendada para más adelante saldría como "0 presentes", que
      // se lee igual que "no fue nadie". Hay que decir que todavía no ocurre.
      const aunNoOcurre = toDate(s.date).getTime() > hoy.getTime();
      return (
        `${fmtDate(s.date)} · ${SESSION_TYPE_LABELS[s.type]} · ${MODALITY_LABELS[s.modality]} · ` +
        (aunNoOcurre ? 'AGENDADA (todavía no ocurre)' : `${presentes.get(s.id) ?? 0} presentes`) +
        (s.coordinator ? ` · coordinó ${s.coordinator}` : '') +
        (s.status === 'open' ? ' · ABIERTA' : '') +
        `\n  id: ${s.id}`
      );
    })
    .join('\n');
}

export function informeAsistenciaReunion(
  sessions: Session[],
  attendance: Attendance[],
  reunionId: string,
): string {
  const s = sessions.find((x) => x.id === reunionId);
  if (!s) return `No existe ninguna reunión con id ${reunionId}.`;

  const gente = attendance
    .filter((a) => a.sessionId === reunionId)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));

  return [
    `${SESSION_TYPE_LABELS[s.type]} — ${fmtDate(s.date)} · ${MODALITY_LABELS[s.modality]}` +
      (s.coordinator ? ` · coordinó ${s.coordinator}` : ''),
    `${gente.length} presentes:`,
    ...gente.map((a) => `  - ${a.fullName}`),
  ].join('\n');
}

export function informeBuscarPersona(personas: MemberPublico[], nombre: string): string {
  const palabras = normalizeText(nombre).split(/\s+/).filter(Boolean);
  const encontradas = personas
    .filter((p) => {
      const objetivo = p.searchName || normalizeText(p.fullName);
      return palabras.every((w) => objetivo.includes(w));
    })
    .slice(0, 25);

  if (encontradas.length === 0) return `Nadie coincide con "${nombre}".`;

  return encontradas
    .map(
      (p) =>
        `${p.fullName}` +
        (p.active === false ? ' (inactiva)' : '') +
        (p.pendingReview ? ' (esperando revisión)' : '') +
        (p.pendingIdentify ? ' (sin nombre confirmado)' : '') +
        `\n  id: ${p.id}`,
    )
    .join('\n');
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
  const hechas = (t: SessionType) => realizadas(sessions, hoy).filter((s) => s.type === t).length;
  const pct = (h: number, total: number) =>
    total > 0 ? ` (${Math.round((h / total) * 100)}% de ${total})` : '';

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

export function informePorRevisar(personas: MemberPublico[]): string {
  const pendientes = personas.filter((p) => p.pendingReview || p.pendingIdentify);
  if (pendientes.length === 0) return 'No hay nadie esperando revisión.';

  return pendientes
    .map(
      (p) =>
        `${p.fullName}` +
        (p.pendingIdentify ? ' (sin nombre confirmado)' : '') +
        (p.createdByName ? ` · la registró ${p.createdByName}` : '') +
        (p.sourceSessionDate ? ` · el ${fmtDate(p.sourceSessionDate)}` : '') +
        `\n  id: ${p.id}`,
    )
    .join('\n');
}
