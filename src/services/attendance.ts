import {
  collection,
  collectionGroup,
  doc,
  setDoc,
  onSnapshot,
  writeBatch,
  increment,
  Timestamp,
  type SnapshotMetadata,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Attendance, Session, Member, SessionType, Modality } from '../types';
import type { UserProfile } from '../types';

function attendanceCol(sessionId: string) {
  return collection(db, 'sessions', sessionId, 'attendance');
}

type AttHandler = (rows: Attendance[], meta: SnapshotMetadata) => void;

/** Escucha en vivo la asistencia de una sesión (tiempo real entre dispositivos). */
export function listenAttendance(
  sessionId: string,
  onData: AttHandler,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    attendanceCol(sessionId),
    (snap) => {
      const rows = snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<Attendance, 'id'>) }),
      );
      onData(rows, snap.metadata);
    },
    onError,
  );
}

/**
 * Marca presente. El ID del documento es el memberId → nunca hay duplicados
 * aunque varias coordinadoras marquen a la vez.
 *
 * En el MISMO lote (writeBatch) se incrementa el contador de la sesión, así:
 * - el contador lo mantiene quien realiza la acción (no cada dispositivo que mira),
 * - funciona offline (se sincroniza al reconectar),
 * - `checkedInAt` usa Timestamp.now() (hora real del marcaje) en vez de
 *   serverTimestamp(), que quedaría null en la caché offline.
 */
export async function markPresent(
  session: Session,
  member: Pick<Member, 'id' | 'fullName'>,
  user: UserProfile,
) {
  const batch = writeBatch(db);
  const ref = doc(db, 'sessions', session.id, 'attendance', member.id);
  batch.set(ref, {
    memberId: member.id,
    fullName: member.fullName,
    status: 'present',
    checkedInAt: Timestamp.now(),
    checkedInBy: user.uid,
    checkedInByName: user.displayName || user.email,
    // Datos de la sesión denormalizados para reportes.
    sessionId: session.id,
    sessionType: session.type,
    modality: session.modality,
    sessionDate: session.date,
  });
  batch.update(doc(db, 'sessions', session.id), {
    presentCount: increment(1),
  });
  await batch.commit();
}

/** Desmarca (borra el documento de asistencia y ajusta el contador). */
export async function unmarkPresent(sessionId: string, memberId: string) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'sessions', sessionId, 'attendance', memberId));
  batch.update(doc(db, 'sessions', sessionId), {
    presentCount: increment(-1),
  });
  await batch.commit();
}

/**
 * Escribe una asistencia HISTÓRICA (importación) con fecha propia (la de la
 * reunión), sin tocar el contador (se fija al final). No usa Timestamp.now().
 */
export async function writeImportedAttendance(
  sessionId: string,
  meta: { type: SessionType; modality: Modality; dateTs: Timestamp },
  member: Pick<Member, 'id' | 'fullName'>,
) {
  const ref = doc(db, 'sessions', sessionId, 'attendance', member.id);
  await setDoc(ref, {
    memberId: member.id,
    fullName: member.fullName,
    status: 'present',
    checkedInAt: meta.dateTs,
    checkedInBy: 'import',
    checkedInByName: 'Importado (Meet)',
    sessionId,
    sessionType: meta.type,
    modality: meta.modality,
    sessionDate: meta.dateTs,
  });
}

/**
 * Escucha TODA la asistencia (todas las sesiones) para el panel/reportes.
 * Usa una consulta de grupo de colección; se filtra/agrega en el cliente
 * para no requerir índices personalizados.
 */
export function listenAllAttendance(
  onData: (rows: Attendance[]) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    collectionGroup(db, 'attendance'),
    (snap) => {
      const rows = snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<Attendance, 'id'>) }),
      );
      onData(rows);
    },
    onError,
  );
}
