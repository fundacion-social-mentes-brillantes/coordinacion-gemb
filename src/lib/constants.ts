import type { Role, SessionType, Modality } from '../types';

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  entrega_pasos: 'Entrega de Pasos',
  reduccion_ego: 'Sala de Reducción del Ego',
};

export const SESSION_TYPE_SHORT: Record<SessionType, string> = {
  entrega_pasos: 'Pasos',
  reduccion_ego: 'Ego',
};

export const MODALITY_LABELS: Record<Modality, string> = {
  virtual: 'Virtual',
  presencial: 'Presencial',
};

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Principal',
  admin: 'Administrador',
  coordinador: 'Coordinador',
  pending: 'Pendiente de aprobación',
};

/**
 * Los tres roles que se ven en la app. "Coordinador de coordinadores" es un
 * Coordinador con permiso de agendar el Calendario (puedeProgramar).
 */
export type RolVisible = 'coordinador' | 'coordinador_coordinadores' | 'admin';
export const ROL_VISIBLE: Record<RolVisible, { nombre: string; detalle: string }> = {
  coordinador: {
    nombre: 'Coordinador',
    detalle: 'Toma asistencia y ve el calendario.',
  },
  coordinador_coordinadores: {
    nombre: 'Coordinador de coordinadores',
    detalle: 'Además agenda el calendario: decide quién coordina cada reunión.',
  },
  admin: {
    nombre: 'Administrador',
    detalle: 'Además ve el Panel, las Personas y los Usuarios.',
  },
};

/** El rol visible de alguien según sus datos. */
export function rolVisibleDe(p: { role: Role; puedeProgramar?: boolean }): RolVisible | null {
  if (p.role === 'admin') return 'admin';
  if (p.role === 'coordinador') return p.puedeProgramar ? 'coordinador_coordinadores' : 'coordinador';
  return null;
}

/** Cómo se llama el rol de alguien en pantalla. */
export function nombreDeRol(p: { role: Role; puedeProgramar?: boolean } | null | undefined): string {
  if (!p) return '';
  if (p.role === 'super_admin') return 'Principal';
  const r = rolVisibleDe(p);
  return r ? ROL_VISIBLE[r].nombre : ROLE_LABELS[p.role];
}

export const SESSION_TYPES: SessionType[] = ['entrega_pasos', 'reduccion_ego'];
export const MODALITIES: Modality[] = ['presencial', 'virtual'];
export const ASSIGNABLE_ROLES: Role[] = ['admin', 'coordinador'];

/** Coordinadoras habituales: atajos al asignar quién coordina una sesión. */
export const COORDINATOR_NAMES = [
  'Alexandra Ortega',
  'Eva Simbaqueba',
  'Jessica Becerra',
  'Marcela Sánchez',
  'Tatiana López',
];

/** Prefijo con el que se crean las personas marcadas sin saber su nombre. */
export const UNKNOWN_PREFIX = 'Por identificar';
