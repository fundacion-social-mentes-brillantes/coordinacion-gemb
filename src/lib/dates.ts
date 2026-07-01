import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Timestamp } from 'firebase/firestore';

/**
 * Convierte a Date cualquier valor de fecha que venga de Firestore.
 * Soporta Timestamp, Date, número (ms) o el sentinel pendiente (null) de
 * serverTimestamp(), en cuyo caso usa "ahora" como aproximación.
 */
export function toDate(value: unknown): Date {
  if (!value) return new Date();
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  // Objeto tipo Timestamp con método toDate (por si acaso).
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

export const fmtDate = (v: unknown) =>
  format(toDate(v), 'd MMM yyyy', { locale: es });

export const fmtDateShort = (v: unknown) =>
  format(toDate(v), 'dd/MM/yyyy', { locale: es });

export const fmtTime = (v: unknown) => format(toDate(v), 'HH:mm', { locale: es });

export const fmtDateTime = (v: unknown) =>
  format(toDate(v), "dd/MM/yyyy HH:mm", { locale: es });

/** yyyy-MM-dd para <input type="date"> */
export const toInputDate = (v: unknown) => format(toDate(v), 'yyyy-MM-dd');

/** Convierte "yyyy-MM-dd" (de un input date) a Date local a mediodía. */
export function fromInputDate(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  // Mediodía local evita saltos de día por zona horaria.
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

export const MONTH_NAMES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];
