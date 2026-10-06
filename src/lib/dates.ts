import { format } from 'date-fns';
import { es } from 'date-fns/locale';

/**
 * Convierte a Date cualquier valor de fecha que venga de Firestore.
 * Soporta Timestamp, Date, número (ms) o el sentinel pendiente (null) de
 * serverTimestamp(), en cuyo caso usa "ahora" como aproximación.
 *
 * No importa `Timestamp` del SDK a propósito: la rama de abajo ya lo cubre
 * (cualquier objeto con `toDate()`), y así este módulo —y `activity.ts`, que
 * depende de él— sirve igual en el navegador y en el servidor MCP, que usa
 * el SDK de administración con otra clase Timestamp.
 */
export function toDate(value: unknown): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  // Objeto tipo Timestamp (cliente o admin): tiene toDate().
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return new Date();
    }
  }
  if (typeof value === 'number') return new Date(value);
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? new Date() : d;
}

export const fmtDateLong = (v: unknown) =>
  format(toDate(v), "EEEE d 'de' MMMM 'de' yyyy", { locale: es });

/** Primera letra en mayúscula ("martes 6 de…" → "Martes 6 de…"). */
export const capitalizeFirst = (s: string) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/* ------------------------------------------------------------------ */
/* El "día" de la fundación es el de Bogotá                            */
/* ------------------------------------------------------------------ */
// Las reuniones se guardan al mediodía de Bogotá (17:00 UTC). Para saber si
// una sesión es "la de hoy" no sirve la zona del dispositivo (el servidor del
// MCP corre en UTC, y a las 7 p. m. de Colombia ya sería "mañana").

const DIA_BOGOTA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "2026-10-06": el día en Bogotá de una fecha. */
export const dayKey = (v: unknown) => DIA_BOGOTA.format(toDate(v));

/** Días entre el día (en Bogotá) de `v` y el de `now`: 0 = hoy, 1 = mañana, -1 = ayer. */
export function daysFromToday(v: unknown, now: Date = new Date()): number {
  const a = Date.parse(`${dayKey(v)}T00:00:00Z`);
  const b = Date.parse(`${dayKey(now)}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

/** Fin del día de hoy en Bogotá (para "lo que ya ocurrió"). */
export function endOfTodayBogota(now: Date = new Date()): Date {
  // Medianoche de mañana en Bogotá = 05:00 UTC de ese día.
  return new Date(Date.parse(`${dayKey(now)}T00:00:00Z`) + 86_400_000 + 5 * 3_600_000);
}

/**
 * ¿Puede una coordinadora tomar lista en una sesión de esta fecha?
 * Es la MISMA ventana que exigen las reglas de Firestore (sessionInWindow):
 * desde 12 h antes de la fecha guardada (medianoche de Bogotá del día de la
 * reunión) hasta 3 días después.
 */
export function inMarkingWindow(v: unknown, now: Date = new Date()): boolean {
  const t = toDate(v).getTime();
  return t <= now.getTime() + 12 * 3_600_000 && t >= now.getTime() - 3 * 86_400_000;
}

/** La fecha de una reunión del día "yyyy-MM-dd": mediodía de Bogotá. */
export function sessionDateFromKey(key: string): Date {
  return new Date(`${key}T12:00:00-05:00`);
}

export const fmtDate = (v: unknown) =>
  format(toDate(v), 'd MMM yyyy', { locale: es });

export const fmtDateShort = (v: unknown) =>
  format(toDate(v), 'dd/MM/yyyy', { locale: es });

/** "12 ago" — sin año, para listas cortas donde el año se sobreentiende. */
export const fmtDayMonth = (v: unknown) =>
  format(toDate(v), 'd MMM', { locale: es });

export const fmtTime = (v: unknown) => format(toDate(v), 'HH:mm', { locale: es });

export const fmtDateTime = (v: unknown) =>
  format(toDate(v), "dd/MM/yyyy HH:mm", { locale: es });

/** yyyy-MM-dd para <input type="date"> (el día en Bogotá). */
export const toInputDate = (v: unknown) => dayKey(v);

/** ¿Es "yyyy-MM-dd" una fecha real? (un input date vacío llega como ''). */
export function isValidDateKey(str: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T12:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().startsWith(str);
}

/**
 * Convierte "yyyy-MM-dd" (de un input date) en la fecha de la reunión:
 * mediodía de Bogotá, igual en cualquier dispositivo. Una fecha vacía o
 * imposible lanza error en vez de convertirse en el 1 de enero de 1900.
 */
export function fromInputDate(str: string): Date {
  if (!isValidDateKey(str)) throw new Error(`Fecha inválida: "${str}"`);
  return sessionDateFromKey(str);
}

export const MONTH_NAMES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];
