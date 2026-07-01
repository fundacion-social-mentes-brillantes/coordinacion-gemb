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
  super_admin: 'Super administrador',
  admin: 'Administrador(a)',
  coordinador: 'Coordinador(a)',
  pending: 'Pendiente de aprobación',
};

export const SESSION_TYPES: SessionType[] = ['entrega_pasos', 'reduccion_ego'];
export const MODALITIES: Modality[] = ['presencial', 'virtual'];
export const ASSIGNABLE_ROLES: Role[] = ['admin', 'coordinador'];
