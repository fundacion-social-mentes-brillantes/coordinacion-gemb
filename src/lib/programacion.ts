import type { Modality, SessionType } from '../types';
import { MODALITY_LABELS, SESSION_TYPE_LABELS, COORDINATOR_NAMES } from './constants';
import { normalizeText } from './normalize';
import { sessionDateFromKey } from './dates';

// ---------------------------------------------------------------------------
//  Programación (el antiguo "Calendario"): qué reunión hay cada día, a qué
//  hora, si es virtual o presencial y quién la coordina.
//
//  Lógica pura, sin Firebase: la usan la pantalla, la página pública, la
//  imagen del mes y el servidor de Claude, así que todos dicen lo mismo.
//
//  Los días se manejan como texto "aaaa-mm-dd" (el día en Bogotá) y las
//  cuentas se hacen al mediodía UTC: así ningún huso horario corre un día.
// ---------------------------------------------------------------------------

/** Cómo es cada día de la semana normalmente ('0' domingo … '6' sábado). */
export interface DiaBase {
  activo: boolean;
  actividades: SessionType[];
  horario: string;
  /** Si es true, ese día siempre es virtual (no sigue la regla de semanas). */
  siempreVirtual: boolean;
}

export interface ProgramacionConfig {
  dias: Record<string, DiaBase>;
  /** El equipo que puede coordinar (y que puede "apartar" fechas). */
  coordinadoras: string[];
  /** Temporada: antes y después no hay reuniones (vacaciones). */
  desde: string;
  hasta: string;
  /** Semanas ISO que son virtuales: las pares o las impares. */
  semanasVirtuales: 'par' | 'impar';
  /** Enlace al grupo de WhatsApp de coordinadoras (opcional). */
  grupoWhatsapp: string;
}

/** Lo que se cambia a mano para un día concreto. Todo es opcional. */
export interface DiaProgramado {
  id: string; // "aaaa-mm-dd"
  coordinadora?: string;
  /** Quién se la tomó con "Yo la coordino" (solo esa cuenta la puede soltar). */
  coordinadoraUid?: string;
  modalidad?: Modality;
  actividades?: SessionType[];
  horario?: string;
  /** Ese día no hay reunión (aunque normalmente sí). */
  cancelada?: boolean;
  motivo?: string;
  /** Hay reunión aunque ese día de la semana normalmente no (p. ej. un sábado). */
  especial?: boolean;
  updatedByName?: string;
}

/** Alguien pidió coordinar una fecha libre ("Apartar"). */
export interface SolicitudApartado {
  id: string; // "aaaa-mm-dd"
  nombre: string;
  estado: 'pendiente';
}

/** Una fecha del calendario, ya resuelta (regla + cambios a mano). */
export interface FechaPlan {
  key: string;
  fecha: Date;
  diaSemana: number;
  actividades: SessionType[];
  horario: string;
  modalidad: Modality;
  /** true si la modalidad se fijó a mano (no sale de la regla). */
  modalidadFija: boolean;
  coordinadora: string;
  /** La cuenta que se la tomó con "Yo la coordino" ('' si la asignó la coordinación). */
  coordinadoraUid: string;
  /** Nombre del festivo, o null. Ese día no hay reunión. */
  festivo: string | null;
  cancelada: boolean;
  motivo: string;
  especial: boolean;
}

const HORARIO = '5:30 PM - 6:45 PM';

/** Lo que había en el Calendario viejo; sirve de punto de partida. */
export const CONFIG_INICIAL: ProgramacionConfig = {
  dias: {
    '0': { activo: false, actividades: [], horario: '', siempreVirtual: false },
    '1': { activo: false, actividades: [], horario: '', siempreVirtual: false },
    '2': { activo: true, actividades: ['reduccion_ego'], horario: HORARIO, siempreVirtual: false },
    '3': { activo: false, actividades: [], horario: '', siempreVirtual: false },
    '4': { activo: true, actividades: ['entrega_pasos'], horario: HORARIO, siempreVirtual: false },
    '5': { activo: false, actividades: [], horario: '', siempreVirtual: false },
    '6': {
      activo: false,
      actividades: ['reduccion_ego', 'entrega_pasos'],
      horario: '3:00 PM - 5:00 PM',
      siempreVirtual: true,
    },
  },
  coordinadoras: [...COORDINATOR_NAMES],
  desde: '2026-02-03',
  hasta: '2026-12-10',
  semanasVirtuales: 'par',
  grupoWhatsapp: '',
};

export const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
export const NOMBRES_DIA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const DIA_CORTO = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

/* ------------------------------------------------------------------ */
/* Fechas                                                              */
/* ------------------------------------------------------------------ */

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 12));
export const claveDe = (d: Date) => d.toISOString().slice(0, 10);
export const deClave = (key: string) => new Date(`${key}T12:00:00Z`);

/** Número de semana ISO 8601 (la semana empieza el lunes). */
export function semanaISO(key: string): number {
  const d = deClave(key);
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dia); // el jueves de esa semana
  const inicio = Date.UTC(d.getUTCFullYear(), 0, 1, 12);
  return Math.ceil(((d.getTime() - inicio) / 86_400_000 + 1) / 7);
}

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher). */
function pascua(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(y, mes - 1, dia);
}

const sumarDias = (d: Date, n: number) => utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n);
/** Ley Emiliani: si no cae lunes, el festivo se pasa al lunes siguiente. */
const alLunes = (d: Date) => sumarDias(d, (8 - d.getUTCDay()) % 7);

const cacheFestivos = new Map<number, Map<string, string>>();

/**
 * Festivos de Colombia de un año: "aaaa-mm-dd" → nombre. Se calculan, así
 * que sirven para cualquier año (el Calendario viejo los tenía escritos a
 * mano solo para 2026 y dejaba de funcionar en diciembre).
 */
export function festivosColombia(y: number): Map<string, string> {
  const hit = cacheFestivos.get(y);
  if (hit) return hit;
  const f = new Map<string, string>();
  const poner = (d: Date, nombre: string) => f.set(claveDe(d), nombre);
  poner(utc(y, 0, 1), 'Año Nuevo');
  poner(alLunes(utc(y, 0, 6)), 'Reyes Magos');
  poner(alLunes(utc(y, 2, 19)), 'San José');
  const p = pascua(y);
  poner(sumarDias(p, -3), 'Jueves Santo');
  poner(sumarDias(p, -2), 'Viernes Santo');
  poner(utc(y, 4, 1), 'Día del Trabajo');
  poner(sumarDias(p, 43), 'Ascensión del Señor');
  poner(sumarDias(p, 64), 'Corpus Christi');
  poner(sumarDias(p, 71), 'Sagrado Corazón');
  poner(alLunes(utc(y, 5, 29)), 'San Pedro y San Pablo');
  poner(utc(y, 6, 20), 'Día de la Independencia');
  poner(utc(y, 7, 7), 'Batalla de Boyacá');
  poner(alLunes(utc(y, 7, 15)), 'Asunción de la Virgen');
  poner(alLunes(utc(y, 9, 12)), 'Día de la Diversidad Étnica y Cultural');
  poner(alLunes(utc(y, 10, 1)), 'Todos los Santos');
  poner(alLunes(utc(y, 10, 11)), 'Independencia de Cartagena');
  poner(utc(y, 11, 8), 'Inmaculada Concepción');
  poner(utc(y, 11, 25), 'Navidad');
  cacheFestivos.set(y, f);
  return f;
}

/* ------------------------------------------------------------------ */
/* El plan                                                             */
/* ------------------------------------------------------------------ */

/** Modalidad según la regla: semanas alternas, o siempre virtual ese día. */
export function modalidadPorRegla(key: string, base: DiaBase | undefined, c: ProgramacionConfig): Modality {
  if (base?.siempreVirtual) return 'virtual';
  const par = semanaISO(key) % 2 === 0;
  return par === (c.semanasVirtuales === 'par') ? 'virtual' : 'presencial';
}

/** La fecha resuelta, o null si ese día no hay nada programado. */
export function planDeFecha(
  key: string,
  c: ProgramacionConfig,
  dias: Map<string, DiaProgramado>,
): FechaPlan | null {
  const d = deClave(key);
  const diaSemana = d.getUTCDay();
  const base = c.dias[String(diaSemana)];
  const cambio = dias.get(key);
  const especial = cambio?.especial === true;
  const enTemporada = key >= c.desde && key <= c.hasta;
  if (!especial && !(base?.activo && enTemporada)) return null;

  const actividades = cambio?.actividades?.length
    ? cambio.actividades
    : base?.actividades?.length
      ? base.actividades
      : ['reduccion_ego' as SessionType];
  return {
    key,
    fecha: sessionDateFromKey(key),
    diaSemana,
    actividades,
    horario: cambio?.horario || base?.horario || '',
    modalidad: cambio?.modalidad ?? modalidadPorRegla(key, base, c),
    modalidadFija: !!cambio?.modalidad,
    coordinadora: cambio?.coordinadora ?? '',
    coordinadoraUid: cambio?.coordinadora ? cambio.coordinadoraUid ?? '' : '',
    festivo: especial ? null : festivosColombia(d.getUTCFullYear()).get(key) ?? null,
    cancelada: cambio?.cancelada === true,
    motivo: cambio?.motivo ?? '',
    especial,
  };
}

/** Todas las fechas programadas de un mes (0 = enero). */
export function planDelMes(
  y: number,
  m: number,
  c: ProgramacionConfig,
  dias: Map<string, DiaProgramado>,
): FechaPlan[] {
  const out: FechaPlan[] = [];
  const total = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  for (let d = 1; d <= total; d++) {
    const p = planDeFecha(claveDe(utc(y, m, d)), c, dias);
    if (p) out.push(p);
  }
  return out;
}

/** ¿Hay reunión de verdad esa fecha? (no es festivo ni se canceló) */
export const hayReunion = (p: FechaPlan) => !p.festivo && !p.cancelada;

/** "Sala de Reducción del Ego + Entrega de Pasos" */
export const nombreActividades = (a: SessionType[]) =>
  a.map((t) => SESSION_TYPE_LABELS[t]).join(' + ');

/**
 * El nombre tal como está en el equipo, aunque llegue escrito distinto
 * ("tatiana Lopez" → "Tatiana López"). Si no es nadie del equipo, el mismo.
 */
export function nombreDelEquipo(nombre: string, equipo: string[]): string {
  const n = normalizeText(nombre);
  return equipo.find((e) => normalizeText(e) === n) ?? nombre.trim();
}

/** El resumen del mes para pegar en WhatsApp (mismo formato que el viejo). */
export function textoWhatsApp(y: number, m: number, plan: FechaPlan[]): string {
  const lineas = plan.map((p) => {
    const dia = DIA_CORTO[p.diaSemana].charAt(0) + DIA_CORTO[p.diaSemana].slice(1).toLowerCase();
    const estado = p.festivo
      ? `🚫 Festivo (${p.festivo})`
      : p.cancelada
        ? `❌ No hay reunión${p.motivo ? ` (${p.motivo})` : ''}`
        : p.coordinadora
          ? `👤 ${p.coordinadora}`
          : '🔴 Sin coordinadora';
    const modo = hayReunion(p) ? ` (${MODALITY_LABELS[p.modalidad]})` : '';
    return `*${dia} ${p.fecha.getUTCDate()}* [${p.horario}]: ${nombreActividades(p.actividades)}${modo} — ${estado}`;
  });
  return [
    `*🗓️ PROGRAMACIÓN ${NOMBRES_MES[m].toUpperCase()} ${y}*`,
    'Gimnasio Emocional Mentes Brillantes',
    '',
    ...(lineas.length ? lineas : ['No hay reuniones programadas este mes.']),
  ].join('\n');
}

/** Junta lo guardado con los valores por defecto (por si falta algo). */
export function completarConfig(parcial: Partial<ProgramacionConfig> | undefined): ProgramacionConfig {
  const c = parcial ?? {};
  const dias: Record<string, DiaBase> = {};
  for (let i = 0; i < 7; i++) {
    const k = String(i);
    const d = (c.dias ?? {})[k];
    dias[k] = d
      ? {
          activo: d.activo === true,
          actividades: Array.isArray(d.actividades) ? d.actividades : [],
          horario: typeof d.horario === 'string' ? d.horario : '',
          siempreVirtual: d.siempreVirtual === true,
        }
      : CONFIG_INICIAL.dias[k];
  }
  return {
    dias,
    coordinadoras:
      Array.isArray(c.coordinadoras) && c.coordinadoras.length
        ? c.coordinadoras
        : CONFIG_INICIAL.coordinadoras,
    desde: typeof c.desde === 'string' && c.desde ? c.desde : CONFIG_INICIAL.desde,
    hasta: typeof c.hasta === 'string' && c.hasta ? c.hasta : CONFIG_INICIAL.hasta,
    semanasVirtuales: c.semanasVirtuales === 'impar' ? 'impar' : 'par',
    grupoWhatsapp: typeof c.grupoWhatsapp === 'string' ? c.grupoWhatsapp : '',
  };
}

/* ------------------------------------------------------------------ */
/* El calendario de mes (Coordinación)                                 */
/* ------------------------------------------------------------------ */

/** La clave del día `n` días antes o después ("2026-10-15", 2 → "2026-10-17"). */
export const moverDia = (key: string, n: number) => claveDe(sumarDias(deClave(key), n));

/**
 * Un día que normalmente no tiene reunión, listo para que quien programa
 * ponga una reunión especial (por ejemplo, un sábado).
 */
export function planNuevo(key: string, c: ProgramacionConfig): FechaPlan {
  const diaSemana = deClave(key).getUTCDay();
  const base = c.dias[String(diaSemana)];
  return {
    key,
    fecha: sessionDateFromKey(key),
    diaSemana,
    actividades: base?.actividades?.length ? base.actividades : ['reduccion_ego'],
    horario: base?.horario || '',
    modalidad: modalidadPorRegla(key, base, c),
    modalidadFija: false,
    coordinadora: '',
    coordinadoraUid: '',
    festivo: null,
    cancelada: false,
    motivo: '',
    especial: true,
  };
}

/**
 * Cómo se pinta la fecha: verde libre, rojo ya tiene coordinadora, dorado te
 * toca a ti, gris no hay reunión (festivo o cancelada).
 */
export type EstadoFecha = 'libre' | 'ocupada' | 'tuya' | 'sin';

export function estadoDeFecha(p: FechaPlan, yo: { uid?: string; nombre?: string }): EstadoFecha {
  if (!hayReunion(p)) return 'sin';
  if (!p.coordinadora) return 'libre';
  if ((yo.uid && p.coordinadoraUid === yo.uid) || (yo.nombre && p.coordinadora === yo.nombre)) {
    return 'tuya';
  }
  return 'ocupada';
}

/**
 * El nombre del equipo que le corresponde a un nombre de Google, aunque traiga
 * más apellidos o sin tildes ("marcela sanchez rojas" → "Marcela Sánchez").
 * '' si no hay uno solo que encaje.
 */
export function buscarEnEquipo(nombre: string, equipo: string[]): string {
  const n = normalizeText(nombre);
  if (!n) return '';
  const exacto = equipo.find((e) => normalizeText(e) === n);
  if (exacto) return exacto;
  const palabras = new Set(n.split(' '));
  const parecidos = equipo.filter((e) => {
    const p = normalizeText(e).split(' ').filter(Boolean);
    return p.length >= 2 && p.every((x) => palabras.has(x));
  });
  return parecidos.length === 1 ? parecidos[0] : '';
}

/** El aviso para el grupo cuando alguien se toma una fecha. */
export function mensajeCoordino(p: FechaPlan, nombre: string): string {
  return [
    '*Coordino esta reunión* ✨',
    '',
    `📅 *Fecha:* ${NOMBRES_DIA[p.diaSemana]} ${p.fecha.getUTCDate()} de ${NOMBRES_MES[
      p.fecha.getUTCMonth()
    ].toLowerCase()}`,
    `🎯 *Reunión:* ${nombreActividades(p.actividades)}`,
    `⏰ *Horario:* ${p.horario}${p.horario ? ' ' : ''}(${MODALITY_LABELS[p.modalidad]})`,
    `👤 *Coordina:* ${nombre}`,
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Enlaces de las reuniones                                            */
/* ------------------------------------------------------------------ */

/** El enlace fijo de Meet de cada reunión (solo lo ve el equipo). */
export type EnlacesMeet = Partial<Record<SessionType, string>>;

/** ¿Es un enlace de Google Meet? (https://meet.google.com/abc-defg-hij) */
export const esEnlaceMeet = (u: string) =>
  /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,60}(\?[^\s]*)?$/i.test(u.trim());
