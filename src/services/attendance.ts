import {
  collection,
  collectionGroup,
  doc,
  setDoc,
  onSnapshot,
  writeBatch,
  increment,
  serverTimestamp,
  Timestamp,
  type SnapshotMetadata,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { buildNameParts } from '../lib/normalize';
import { walkinId } from '../lib/ids';
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
    // Sin `includeMetadataChanges` no llega el aviso de "esto ya viene del
    // servidor": el rótulo "Sincronizando…" se quedaría puesto y el cuadre
    // del contador no llegaría a ejecutarse nunca.
    { includeMetadataChanges: true },
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
 *
 * Si otra coordinadora ya la había marcado, las reglas rechazan el lote ENTERO
 * (asistencia y +1 juntos): el contador no se infla y se conserva su hora de
 * llegada original.
 *
 * Devuelve la promesa del envío al servidor, pero la pantalla NO debe
 * esperarla para seguir: la marca ya quedó en el teléfono al llamar, y sin
 * señal esa promesa no se resuelve hasta reconectar.
 */
export function markPresent(
  session: Session,
  member: Pick<Member, 'id' | 'fullName'>,
  user: UserProfile,
): Promise<void> {
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
  return batch.commit();
}

/**
 * Crea una persona nueva Y la marca presente en un SOLO lote atómico.
 *
 * La persona NO entra a la lista oficial: queda marcada como "por revisar"
 * para que una administradora confirme o corrija el nombre (a menudo llega
 * solo un nombre suelto, como "Sandra"). Su asistencia sí se registra, para
 * que la lista de la reunión quede completa.
 *
 * Se hace en un único lote: si la sesión se hubiera finalizado entre medias
 * (otra coordinadora, otro celular), se rechaza todo junto y no queda una
 * ficha huérfana en la base.
 *
 * El id de la ficha sale de la sesión y del nombre: si dos coordinadoras
 * agregan a la misma persona nueva en la misma reunión (o una pulsa dos
 * veces), las dos apuntan a la MISMA ficha y la segunda asistencia la
 * rechazan las reglas. Antes quedaban dos "Rous" idénticas.
 *
 * Como `markPresent`, no hay que esperar `done` para seguir: sin señal no se
 * resuelve hasta reconectar.
 */
export function addWalkinAndMarkPresent(
  session: Session,
  input: { fullName: string; notes?: string; pendingIdentify?: boolean },
  user: UserProfile,
): { id: string; done: Promise<void> } {
  const parts = buildNameParts(input.fullName);
  const memberRef = input.pendingIdentify
    ? // "Por identificar (seña)": cada una es alguien distinto.
      doc(collection(db, 'members'))
    : doc(db, 'members', walkinId(session.id, parts.searchName));
  const batch = writeBatch(db);

  batch.set(memberRef, {
    fullName: parts.fullName,
    firstName: parts.firstName,
    lastName: parts.lastName,
    searchName: parts.searchName,
    aliases: [],
    phone: '',
    notes: input.notes ?? '',
    active: true,
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    createdByName: user.displayName || user.email,
    pendingIdentify: input.pendingIdentify ?? false,
    // Queda fuera de la lista oficial hasta que la administradora la revise.
    pendingReview: true,
    sourceSessionId: session.id,
    sourceSessionDate: session.date,
  });
  batch.set(doc(db, 'sessions', session.id, 'attendance', memberRef.id), {
    memberId: memberRef.id,
    fullName: parts.fullName,
    status: 'present',
    checkedInAt: Timestamp.now(),
    checkedInBy: user.uid,
    checkedInByName: user.displayName || user.email,
    sessionId: session.id,
    sessionType: session.type,
    modality: session.modality,
    sessionDate: session.date,
  });
  batch.update(doc(db, 'sessions', session.id), {
    presentCount: increment(1),
  });

  return { id: memberRef.id, done: batch.commit() };
}

/**
 * Desmarca (borra el documento de asistencia y ajusta el contador). Si otra
 * coordinadora ya la había quitado, las reglas rechazan el lote y el contador
 * no baja dos veces. Igual que al marcar, no hay que esperar la promesa.
 */
export function unmarkPresent(sessionId: string, memberId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'sessions', sessionId, 'attendance', memberId));
  batch.update(doc(db, 'sessions', sessionId), {
    presentCount: increment(-1),
  });
  return batch.commit();
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
