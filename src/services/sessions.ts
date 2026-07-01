import {
  collection,
  query,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Session, SessionType, Modality, SessionStatus } from '../types';
import type { UserProfile } from '../types';
import { toDate } from '../lib/dates';

const sessionsCol = collection(db, 'sessions');

/** Escucha en vivo la lista de sesiones (más recientes primero). */
export function listenSessions(
  onData: (sessions: Session[]) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    query(sessionsCol),
    (snap) => {
      const list = snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<Session, 'id'>) }),
      );
      list.sort((a, b) => toDate(b.date).getTime() - toDate(a.date).getTime());
      onData(list);
    },
    onError,
  );
}

/** Escucha una sesión concreta. */
export function listenSession(
  id: string,
  onData: (session: Session | null) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    doc(db, 'sessions', id),
    (snap) => {
      if (snap.exists()) {
        onData({ id: snap.id, ...(snap.data() as Omit<Session, 'id'>) });
      } else {
        onData(null);
      }
    },
    onError,
  );
}

export interface NewSessionInput {
  type: SessionType;
  modality: Modality;
  date: Date;
}

export async function createSession(
  input: NewSessionInput,
  user: UserProfile,
): Promise<string> {
  const ref = await addDoc(sessionsCol, {
    type: input.type,
    modality: input.modality,
    date: Timestamp.fromDate(input.date),
    status: 'open' as SessionStatus,
    createdBy: user.uid,
    createdByName: user.displayName || user.email,
    createdAt: serverTimestamp(),
    presentCount: 0,
  });
  return ref.id;
}

export async function setSessionStatus(id: string, status: SessionStatus) {
  await updateDoc(doc(db, 'sessions', id), { status });
}

/** Borra una sesión y toda su asistencia (solo admin). */
export async function deleteSession(id: string) {
  const attSnap = await getDocs(collection(db, 'sessions', id, 'attendance'));
  const CHUNK = 400;
  const docs = attSnap.docs;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const d of docs.slice(i, i + CHUNK)) batch.delete(d.ref);
    await batch.commit();
  }
  await deleteDoc(doc(db, 'sessions', id));
}
