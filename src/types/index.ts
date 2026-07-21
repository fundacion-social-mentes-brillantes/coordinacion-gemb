import type { Timestamp } from 'firebase/firestore';

// --- Roles ---
export type Role = 'super_admin' | 'admin' | 'coordinador' | 'pending';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: Role;
  active: boolean;
  createdAt?: Timestamp | null;
}

// --- Sesiones (reuniones) ---
export type SessionType = 'entrega_pasos' | 'reduccion_ego';
export type Modality = 'virtual' | 'presencial';
export type SessionStatus = 'open' | 'closed';

export interface Session {
  id: string;
  type: SessionType;
  modality: Modality;
  date: Timestamp;
  status: SessionStatus;
  createdBy: string;
  createdByName: string;
  createdAt?: Timestamp | null;
  presentCount?: number;
  /** Nombre de quien coordina la reunión (texto libre; '' = sin asignar). */
  coordinator?: string;
}

// --- Personas (lista maestra) ---
export interface Member {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  /** Nombre completo normalizado (sin acentos, minúsculas) para búsqueda instantánea. */
  searchName: string;
  aliases: string[];
  phone?: string;
  notes?: string;
  active: boolean;
  createdAt?: Timestamp | null;
  createdBy?: string;
  /**
   * true = se marcó presente sin saber su nombre ("Por identificar…").
   * Al ponerle el nombre real (o fusionarla con alguien existente) se limpia.
   */
  pendingIdentify?: boolean;
}

// --- Asistencia ---
// El ID del documento SIEMPRE es el memberId → marcar = crear, desmarcar = borrar.
// Se denormalizan datos de la sesión y de la persona para reportes rápidos.
export interface Attendance {
  id: string; // == memberId
  memberId: string;
  fullName: string;
  status: 'present';
  checkedInAt: Timestamp;
  checkedInBy: string;
  checkedInByName: string;
  // Datos de la sesión (denormalizados para el panel/reportes).
  sessionId: string;
  sessionType: SessionType;
  modality: Modality;
  sessionDate: Timestamp;
}
