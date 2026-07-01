import {
  collection,
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

// --- Invitaciones (pre-autorizar por correo antes del primer ingreso) ---

export interface Invite {
  id: string; // correo en minúsculas
  email: string;
  role: Role;
  createdByName?: string;
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
  role: Role,
  createdBy: UserProfile,
) {
  const id = email.trim().toLowerCase();
  await setDoc(doc(db, 'invites', id), {
    email: id,
    role,
    createdBy: createdBy.uid,
    createdByName: createdBy.displayName || createdBy.email,
    createdAt: serverTimestamp(),
  });
}

export async function deleteInvite(id: string) {
  await deleteDoc(doc(db, 'invites', id));
}
