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
