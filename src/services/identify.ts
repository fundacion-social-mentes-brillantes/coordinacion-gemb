import {
  arrayUnion,
  collectionGroup,
  getDocsFromServer,
  query,
  where,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
  increment,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { buildNameParts, normalizeText } from '../lib/normalize';
import { UNKNOWN_PREFIX } from '../lib/constants';
import { updateMember } from './members';
import type { Attendance, Member } from '../types';

// Flujo "Por identificar": alguien se marcó presente sin saber su nombre y
// después se corrige. Como la asistencia denormaliza `fullName` (y su ID de
// documento es el memberId), corregir implica tocar TODAS sus asistencias.

/**
 * Trae los documentos de asistencia de UNA persona (en cualquier sesión).
 *
 * Antes se descargaba TODA la asistencia de la historia (cientos de lecturas
 * cobradas) para quedarse con unos pocos. Ahora la consulta filtra en el
 * servidor (índice de grupo de colección sobre memberId, en
 * firestore.indexes.json).
 *
 * Siempre DEL SERVIDOR: sin internet real, Firestore respondería con lo
 * guardado en el teléfono, y actuar sobre esa foto incompleta borraría de
 * menos o dejaría asistencias huérfanas. Sin conexión, esto falla y la
 * corrección se pide con señal.
 */
async function attendanceDocsOf(memberId: string) {
  const snap = await getDocsFromServer(
    query(collectionGroup(db, 'attendance'), where('memberId', '==', memberId)),
  );
  return snap.docs;
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
  const mine = await attendanceDocsOf(memberId);
  // Solo las que de verdad tienen otro nombre (antes se reescribían todas).
  const pendientes = mine.filter(
    (d) => (d.data() as Attendance).fullName !== cleanFullName,
  );
  const results = await Promise.allSettled(
    pendientes.map((d) => updateDoc(d.ref, { fullName: cleanFullName })),
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
  // Primero el historial y DESPUÉS la marca: al quitar `pendingIdentify` la
  // coordinadora pierde el permiso sobre esa ficha, así que si se hiciera al
  // revés y algo fallara a mitad, ya no podría reintentarlo.
  const res = await propagateNameToAttendance(memberId, parts.fullName);
  await updateMember(memberId, {
    fullName: parts.fullName,
    pendingIdentify: false,
  });
  return res;
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
  // Primero el historial y DESPUÉS la aprobación: si la corrección del
  // historial falla, la persona sigue "por revisar" (se puede reintentar) en
  // vez de quedar aprobada con el nombre viejo en sus asistencias mientras
  // la pantalla dice "No se pudo aprobar".
  // Se propaga SIEMPRE, aunque el nombre no cambie aquí: si una coordinadora
  // ya lo había corregido y algún registro se quedó atrás, esto lo repara.
  const res = await propagateNameToAttendance(memberId, parts.fullName);
  await updateMember(memberId, {
    ...(cambioNombre ? { fullName: parts.fullName } : {}),
    pendingReview: false,
    pendingIdentify: sigueSinNombre,
  });
  return res;
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
  let mine;
  try {
    mine = await attendanceDocsOf(memberId);
  } catch (e) {
    // Sin conexión real no se puede saber qué borrar: no se toca nada.
    console.error(e);
    throw new Error('SIN_CONEXION_REAL');
  }

  // TODO en un único lote: o se borra la persona con todas sus asistencias, o
  // no se borra nada. Nunca queda a medio camino. Si mientras tanto otra
  // persona quitó alguna de esas asistencias, las reglas rechazan el lote
  // (no se resta dos veces) y se puede reintentar.
  const batch = writeBatch(db);
  for (const d of mine) {
    const data = d.data() as Omit<Attendance, 'id'>;
    const sessionId = d.ref.parent.parent?.id ?? data.sessionId;
    batch.delete(d.ref);
    batch.update(doc(db, 'sessions', sessionId), {
      presentCount: increment(-1),
    });
  }
  batch.delete(doc(db, 'members', memberId));
  await batch.commit();

  return {
    attendanceDeleted: mine.length,
    failed: 0,
    memberDeleted: true,
  };
}

export interface MergeResult {
  moved: number;
  failedSessions: number;
  memberDeleted: boolean;
}

/**
 * "Era alguien que ya está en la base": pasa las asistencias de una ficha
 * (la provisional "Por identificar", la registrada en plena reunión, o una
 * ficha oficial duplicada) a la persona real, y borra la ficha sobrante.
 *
 * Por cada sesión (en un lote atómico):
 * - si la persona real NO estaba marcada → se crea su asistencia (mismos
 *   datos/hora) y se borra la de la ficha sobrante (el contador no cambia);
 * - si la persona real YA estaba marcada → solo se borra la sobrante y el
 *   contador baja en 1 (eran la misma persona contada dos veces).
 *
 * Si mientras tanto alguien marcó o quitó en esa sesión, las reglas rechazan
 * ese lote (nada queda a medias ni se cuenta doble) y esa sesión se cuenta
 * en `failedSessions` para reintentar.
 *
 * La ficha sobrante solo se borra si TODO se pudo mover (las sesiones
 * cerradas pueden fallar si quien fusiona no es admin). Su nombre queda como
 * alias de la persona real: así la próxima vez que la escriban igual, la
 * búsqueda la encuentra en vez de invitar a crearla otra vez.
 */
export async function mergeMemberInto(
  placeholderId: string,
  target: Pick<Member, 'id' | 'fullName'>,
  placeholderName?: string,
): Promise<MergeResult> {
  const [mine, deTarget] = await Promise.all([
    attendanceDocsOf(placeholderId),
    attendanceDocsOf(target.id),
  ]);
  const targetPaths = new Set(deTarget.map((d) => d.ref.path));

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

  // El nombre con que la registraron pasa a ser alias de la persona real
  // (salvo "Por identificar…", que no es un nombre). Solo la administración
  // puede tocar una ficha aprobada: si lo hace una coordinadora, se omite.
  const alias = placeholderName?.trim();
  if (
    memberDeleted &&
    alias &&
    !alias.startsWith(UNKNOWN_PREFIX) &&
    normalizeText(alias) !== normalizeText(target.fullName)
  ) {
    await updateDoc(doc(db, 'members', target.id), { aliases: arrayUnion(alias) }).catch(
      () => {
        /* sin permiso (coordinadora): el alias es un extra, no un requisito */
      },
    );
  }
  return { moved, failedSessions, memberDeleted };
}
