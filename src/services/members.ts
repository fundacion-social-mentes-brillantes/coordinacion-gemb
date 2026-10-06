import {
  collection,
  query,
  where,
  onSnapshot,
  setDoc,
  doc,
  updateDoc,
  serverTimestamp,
  writeBatch,
  type SnapshotMetadata,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Member } from '../types';
import { buildNameParts } from '../lib/normalize';

const membersCol = collection(db, 'members');

type MembersHandler = (members: Member[], meta: SnapshotMetadata) => void;

/** Escucha en vivo la lista de personas (ordenada por nombre). */
export function listenMembers(
  onData: MembersHandler,
  onError: (e: Error) => void,
  opts?: { activeOnly?: boolean },
) {
  const q = opts?.activeOnly
    ? query(membersCol, where('active', '==', true))
    : query(membersCol);
  return onSnapshot(
    q,
    // Con los cambios de metadatos llega también el aviso "esto ya es del
    // servidor" aunque los datos no cambien; sin él, quien muestre "la lista
    // puede estar desactualizada" lo dejaría puesto para siempre.
    { includeMetadataChanges: true },
    (snap) => {
      const list = snap.docs.map(
        (d) => ({ id: d.id, ...(d.data() as Omit<Member, 'id'>) }),
      );
      list.sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
      onData(list, snap.metadata);
    },
    onError,
  );
}

/**
 * Cuenta en vivo las personas registradas en reuniones que la administradora
 * aún no ha revisado (alimenta el aviso de la barra de navegación).
 */
export function listenPendingReviewCount(
  onCount: (n: number) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    query(membersCol, where('pendingReview', '==', true)),
    (snap) => onCount(snap.size),
    (e) => onError?.(e),
  );
}

export interface NewMemberInput {
  fullName: string;
  phone?: string;
  aliases?: string[];
  notes?: string;
  /** true si aún no se sabe su nombre real ("Por identificar…"). */
  pendingIdentify?: boolean;
}

/**
 * Crea una persona (alta manual e importación). El id se arma en el teléfono,
 * así que se conoce aunque no haya señal; la promesa se resuelve cuando el
 * servidor confirma.
 */
export async function createMember(input: NewMemberInput, uid: string) {
  const parts = buildNameParts(input.fullName);
  const ref = doc(membersCol);
  await setDoc(ref, {
    fullName: parts.fullName,
    firstName: parts.firstName,
    lastName: parts.lastName,
    searchName: parts.searchName,
    aliases: input.aliases ?? [],
    phone: input.phone ?? '',
    notes: input.notes ?? '',
    active: true,
    createdAt: serverTimestamp(),
    createdBy: uid,
    pendingIdentify: input.pendingIdentify ?? false,
  });
  return ref.id;
}

/** Actualiza una persona; si cambia el nombre recalcula las partes de búsqueda. */
export async function updateMember(id: string, data: Partial<Member>) {
  const patch: Record<string, unknown> = {};
  if (data.fullName != null) {
    const parts = buildNameParts(data.fullName);
    patch.fullName = parts.fullName;
    patch.firstName = parts.firstName;
    patch.lastName = parts.lastName;
    patch.searchName = parts.searchName;
  }
  if (data.aliases != null) patch.aliases = data.aliases;
  if (data.phone != null) patch.phone = data.phone;
  if (data.notes != null) patch.notes = data.notes;
  if (data.active != null) patch.active = data.active;
  if (data.pendingIdentify != null) patch.pendingIdentify = data.pendingIdentify;
  if (data.pendingReview != null) patch.pendingReview = data.pendingReview;
  await updateDoc(doc(db, 'members', id), patch);
}

export async function setMemberActive(id: string, active: boolean) {
  await updateDoc(doc(db, 'members', id), { active });
}

/** Importa muchas personas por lotes (máx. 400 por lote de Firestore). */
export async function bulkImportMembers(
  rows: NewMemberInput[],
  uid: string,
): Promise<number> {
  let imported = 0;
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const r of rows.slice(i, i + CHUNK)) {
      const parts = buildNameParts(r.fullName);
      if (!parts.fullName) continue;
      const ref = doc(membersCol); // ID automático
      batch.set(ref, {
        fullName: parts.fullName,
        firstName: parts.firstName,
        lastName: parts.lastName,
        searchName: parts.searchName,
        aliases: r.aliases ?? [],
        phone: r.phone ?? '',
        notes: r.notes ?? '',
        active: true,
        createdAt: serverTimestamp(),
        createdBy: uid,
      });
      imported++;
    }
    await batch.commit();
  }
  return imported;
}
