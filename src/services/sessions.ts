import {
  collection,
  query,
  onSnapshot,
  setDoc,
  doc,
  updateDoc,
  deleteDoc,
  getDocsFromServer,
  writeBatch,
  serverTimestamp,
  Timestamp,
  type SnapshotMetadata,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Session, SessionType, Modality, SessionStatus } from '../types';
import type { UserProfile } from '../types';
import { dayKey, toDate } from '../lib/dates';
import { sessionIdDelDia } from '../lib/ids';

const sessionsCol = collection(db, 'sessions');

/** Escucha en vivo la lista de sesiones (más recientes primero). */
export function listenSessions(
  onData: (sessions: Session[], meta: SnapshotMetadata) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    query(sessionsCol),
    // Para saber cuándo la lista ya es la del servidor (y no la del teléfono).
    { includeMetadataChanges: true },
    (snap) => {
      const list = snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<Session, 'id'>) }),
      );
      list.sort((a, b) => toDate(b.date).getTime() - toDate(a.date).getTime());
      onData(list, snap.metadata);
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
  /** Nombre de quien coordina (opcional). */
  coordinator?: string;
}

/**
 * Crea una sesión.
 *
 * La PRIMERA sesión de un tipo en un día tiene un id fijo
 * (`reduccion_ego-2026-10-06`): si dos coordinadoras la crean a la vez, o
 * una sin señal y otra con señal, las dos escriben en la MISMA sesión y sus
 * listas se juntan, en vez de quedar dos sesiones del mismo día (las reglas
 * impiden que la segunda pise a la primera). Solo si se pide a propósito una
 * segunda sesión ese día (`otraMas`) se usa un id aleatorio.
 *
 * No hay que esperar `done` para abrir la sesión: sin señal no se resuelve
 * hasta reconectar, pero la sesión ya existe en el teléfono.
 */
export function createSession(
  input: NewSessionInput,
  user: UserProfile,
  opts: { otraMas?: boolean } = {},
): { id: string; done: Promise<void> } {
  const ref = opts.otraMas
    ? doc(sessionsCol)
    : doc(db, 'sessions', sessionIdDelDia(input.type, dayKey(input.date)));
  const done = setDoc(ref, {
    type: input.type,
    modality: input.modality,
    date: Timestamp.fromDate(input.date),
    status: 'open' as SessionStatus,
    createdBy: user.uid,
    createdByName: user.displayName || user.email,
    createdAt: serverTimestamp(),
    presentCount: 0,
    coordinator: input.coordinator?.trim() ?? '',
  });
  return { id: ref.id, done };
}

export async function setSessionStatus(id: string, status: SessionStatus) {
  await updateDoc(doc(db, 'sessions', id), { status });
}

/** Asigna (o cambia) quién coordina la sesión. '' = sin asignar. */
export async function setSessionCoordinator(id: string, name: string) {
  await updateDoc(doc(db, 'sessions', id), { coordinator: name.trim() });
}

/**
 * Fija el número exacto de presentes.
 *
 * El contador se mantiene sumando y restando de a uno, y eso se desajusta si
 * dos coordinadoras marcan a la MISMA persona (la asistencia queda una sola,
 * pero el contador sumó dos veces). Con esto se vuelve a cuadrar con la
 * cantidad real de nombres.
 */
export async function setSessionPresentCount(id: string, count: number) {
  await updateDoc(doc(db, 'sessions', id), { presentCount: count });
}

/** Fija el conteo de presentes de una sesión importada y su estado. */
export async function finalizeImportedSession(
  id: string,
  presentCount: number,
  status: SessionStatus = 'closed',
) {
  await updateDoc(doc(db, 'sessions', id), { presentCount, status });
}

/**
 * Borra una sesión y toda su asistencia (solo admin).
 *
 * 1. La cierra primero: así ninguna coordinadora sigue marcando mientras se
 *    borra (si no, su marca nueva quedaría huérfana, sin sesión).
 * 2. Lee la asistencia DEL SERVIDOR: con la copia del teléfono (sin señal)
 *    podría faltar algo y quedar registros huérfanos para siempre. Sin
 *    conexión, falla sin borrar nada.
 * 3. Borra todo; la sesión, en el último lote.
 */
export async function deleteSession(id: string) {
  const ref = doc(db, 'sessions', id);
  await updateDoc(ref, { status: 'closed' });
  const attSnap = await getDocsFromServer(collection(db, 'sessions', id, 'attendance'));
  const CHUNK = 400;
  const docs = attSnap.docs;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const d of docs.slice(i, i + CHUNK)) batch.delete(d.ref);
    if (i + CHUNK >= docs.length) batch.delete(ref);
    await batch.commit();
  }
  if (docs.length === 0) await deleteDoc(ref);
}
