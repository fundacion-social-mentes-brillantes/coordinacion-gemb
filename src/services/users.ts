import {
  collection,
  where,
  query,
  onSnapshot,
  doc,
  updateDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { UserProfile, Role } from '../types';
import type { RolVisible } from '../lib/constants';

const usersCol = collection(db, 'users');
const invitesCol = collection(db, 'invites');

/** Escucha en vivo todos los usuarios (para el panel de administración). */
export function listenUsers(
  onData: (users: UserProfile[]) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    query(usersCol),
    (snap) => {
      const list = snap.docs.map(
        (d) => ({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }),
      );
      list.sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email, 'es'));
      onData(list);
    },
    onError,
  );
}

/** Cuántas personas entraron con Google y esperan acceso (aviso de la barra). */
export function listenPendingUsersCount(
  onData: (n: number) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    query(usersCol, where('role', '==', 'pending')),
    (snap) => onData(snap.size),
    onError,
  );
}

/** Aprueba a un usuario pendiente asignándole un rol y activándolo. */
export async function approveUser(uid: string, role: Role) {
  await updateDoc(doc(db, 'users', uid), { role, active: true });
}

export async function updateUserRole(uid: string, role: Role) {
  await updateDoc(doc(db, 'users', uid), { role });
}

export async function setUserActive(uid: string, active: boolean) {
  await updateDoc(doc(db, 'users', uid), { active });
}

/** Permiso para cambiar el Calendario (quién coordina, modalidad, días). */
export async function setPuedeProgramar(uid: string, puede: boolean) {
  await updateDoc(doc(db, 'users', uid), { puedeProgramar: puede });
}

// --- Invitaciones (pre-autorizar por correo antes del primer ingreso) ---

export interface Invite {
  id: string; // correo en minúsculas
  email: string;
  role: Role;
  /** true = entra como Coordinador de coordinadores. */
  puedeProgramar?: boolean;
  createdByName?: string;
}

/** Los datos de un rol visible: rol de la app + permiso de agendar. */
export function datosDeRol(r: RolVisible): { role: Role; puedeProgramar: boolean } {
  if (r === 'admin') return { role: 'admin', puedeProgramar: false };
  return { role: 'coordinador', puedeProgramar: r === 'coordinador_coordinadores' };
}

/** Da acceso (o cambia el rol) en un solo paso. */
export async function asignarRol(uid: string, r: RolVisible) {
  await updateDoc(doc(db, 'users', uid), { ...datosDeRol(r), active: true });
}

/** Quien no es del equipo: se borra su solicitud (puede volver a pedirla). */
export async function borrarSolicitud(uid: string) {
  await deleteDoc(doc(db, 'users', uid));
}

export function listenInvites(
  onData: (invites: Invite[]) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    query(invitesCol),
    (snap) => {
      const list = snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<Invite, 'id'>) }),
      );
      list.sort((a, b) => a.email.localeCompare(b.email, 'es'));
      onData(list);
    },
    onError,
  );
}

export async function createInvite(
  email: string,
  rol: RolVisible,
  createdBy: UserProfile,
) {
  const id = email.trim().toLowerCase();
  const { role, puedeProgramar } = datosDeRol(rol);
  await setDoc(doc(db, 'invites', id), {
    email: id,
    role,
    ...(puedeProgramar ? { puedeProgramar: true } : {}),
    createdBy: createdBy.uid,
    createdByName: createdBy.displayName || createdBy.email,
    createdAt: serverTimestamp(),
  });
}

export async function deleteInvite(id: string) {
  await deleteDoc(doc(db, 'invites', id));
}
