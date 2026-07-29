import {
  collectionGroup,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
  increment,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { buildNameParts } from '../lib/normalize';
import { UNKNOWN_PREFIX } from '../lib/constants';
import { updateMember } from './members';
import type { Attendance, Member } from '../types';

// Flujo "Por identificar": alguien se marcó presente sin saber su nombre y
// después se corrige. Como la asistencia denormaliza `fullName` (y su ID de
// documento es el memberId), corregir implica tocar TODAS sus asistencias.

/** Trae todos los documentos de asistencia de una persona (en cualquier sesión). */
async function attendanceDocsOf(memberId: string) {
  const snap = await getDocs(collectionGroup(db, 'attendance'));
  const mine = snap.docs.filter(
    (d) => (d.data() as Attendance).memberId === memberId,
  );
  return { snap, mine };
}

export interface PropagateResult {
  updated: number;
  failed: number;
}

/**
 * Propaga un cambio de nombre a todas las asistencias de la persona.
 * Puede fallar en sesiones cerradas si quien corrige no es admin; esos
 * casos se cuentan en `failed` para avisar en la interfaz.
 */
export async function propagateNameToAttendance(
  memberId: string,
  cleanFullName: string,
): Promise<PropagateResult> {
  const { mine } = await attendanceDocsOf(memberId);
  const results = await Promise.allSettled(
    mine.map((d) => updateDoc(d.ref, { fullName: cleanFullName })),
  );
  return {
    updated: results.filter((r) => r.status === 'fulfilled').length,
    failed: results.filter((r) => r.status === 'rejected').length,
  };
}

/**
 * Le pone el nombre real a una persona "Por identificar": actualiza su ficha
 * (limpiando la marca) y todo su historial de asistencia.
 */
export async function resolvePlaceholderName(
  memberId: string,
  newName: string,
): Promise<PropagateResult> {
  const parts = buildNameParts(newName);
  await updateMember(memberId, {
    fullName: parts.fullName,
    pendingIdentify: false,
  });
  return propagateNameToAttendance(memberId, parts.fullName);
}

/**
 * La administradora APRUEBA a una persona que registró una coordinadora: pasa
 * a formar parte de la lista oficial. Si de paso corrige el nombre (lo normal
 * cuando llegó solo "Sandra"), el cambio se propaga a todo su historial.
 */
export async function approveMember(
  memberId: string,
  finalName: string,
  currentName: string,
): Promise<PropagateResult> {
  const parts = buildNameParts(finalName);
  const cambioNombre = parts.fullName !== currentName;
  // Si se aprueba sin ponerle un nombre real, sigue "por identificar": no se
  // puede dar por resuelta a alguien que se llama "Por identificar (…)".
  const sigueSinNombre = parts.fullName.startsWith(UNKNOWN_PREFIX);
  await updateMember(memberId, {
    ...(cambioNombre ? { fullName: parts.fullName } : {}),
    pendingReview: false,
    pendingIdentify: sigueSinNombre,
  });
  // Se propaga SIEMPRE, aunque el nombre no cambie aquí: si una coordinadora
  // ya lo había corregido y algún registro se quedó atrás, esto lo repara.
  return propagateNameToAttendance(memberId, parts.fullName);
}

export interface DiscardResult {
  attendanceDeleted: number;
  failed: number;
  memberDeleted: boolean;
}

/**
 * DESCARTA a una persona por revisar: borra su ficha y las asistencias que
 * se le hubieran registrado, y ajusta el contador de cada reunión afectada.
 * Se usa cuando el registro fue un error (por ejemplo, se escribió dos veces).
 */
export async function discardPendingMember(
  memberId: string,
): Promise<DiscardResult> {
  const { mine } = await attendanceDocsOf(memberId);
  let attendanceDeleted = 0;
  let failed = 0;

  for (const d of mine) {
    const data = d.data() as Omit<Attendance, 'id'>;
    const sessionId = d.ref.parent.parent?.id ?? data.sessionId;
    const batch = writeBatch(db);
    batch.delete(d.ref);
    batch.update(doc(db, 'sessions', sessionId), {
      presentCount: increment(-1),
    });
    try {
      await batch.commit();
      attendanceDeleted++;
    } catch (e) {
      console.error('No se pudo borrar la asistencia de la sesión', sessionId, e);
      failed++;
    }
  }

  let memberDeleted = false;
  if (failed === 0) {
    try {
      await deleteDoc(doc(db, 'members', memberId));
      memberDeleted = true;
    } catch (e) {
      console.error('No se pudo borrar la ficha', e);
    }
  }
  return { attendanceDeleted, failed, memberDeleted };
}

export interface MergeResult {
  moved: number;
  failedSessions: number;
  memberDeleted: boolean;
}

/**
 * "Era alguien que ya está en la base": pasa las asistencias de la persona
 * "Por identificar" a la persona real y borra la ficha provisional.
 *
 * Por cada sesión (en un lote atómico):
 * - si la persona real NO estaba marcada → se crea su asistencia (mismos
 *   datos/hora) y se borra la provisional (el contador no cambia: +1 −1);
 * - si la persona real YA estaba marcada → solo se borra la provisional y el
 *   contador baja en 1 (eran la misma persona contada dos veces).
 *
 * La ficha provisional solo se borra si TODO se pudo mover (las sesiones
 * cerradas pueden fallar si quien fusiona no es admin).
 */
export async function mergeMemberInto(
  placeholderId: string,
  target: Pick<Member, 'id' | 'fullName'>,
): Promise<MergeResult> {
  const { snap, mine } = await attendanceDocsOf(placeholderId);
  const targetPaths = new Set(
    snap.docs
      .filter((d) => (d.data() as Attendance).memberId === target.id)
      .map((d) => d.ref.path),
  );

  let moved = 0;
  let failedSessions = 0;
  for (const d of mine) {
    const data = d.data() as Omit<Attendance, 'id'>;
    const sessionId = d.ref.parent.parent?.id ?? data.sessionId;
    const targetRef = doc(db, 'sessions', sessionId, 'attendance', target.id);
    const batch = writeBatch(db);
    if (targetPaths.has(targetRef.path)) {
      // Ya estaba marcada: la provisional era un duplicado.
      batch.delete(d.ref);
      batch.update(doc(db, 'sessions', sessionId), {
        presentCount: increment(-1),
      });
    } else {
      batch.set(targetRef, {
        ...data,
        memberId: target.id,
        fullName: target.fullName,
        sessionId,
      });
      batch.delete(d.ref);
    }
    try {
      await batch.commit();
      moved++;
    } catch (e) {
      console.error('No se pudo mover la asistencia de la sesión', sessionId, e);
      failedSessions++;
    }
  }

  let memberDeleted = false;
  if (failedSessions === 0) {
    try {
      await deleteDoc(doc(db, 'members', placeholderId));
      memberDeleted = true;
    } catch (e) {
      console.error('No se pudo borrar la ficha provisional', e);
    }
  }
  return { moved, failedSessions, memberDeleted };
}
