import {
  collection,
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Modality, SessionType, UserProfile } from '../types';

// ---------------------------------------------------------------------------
//  La imagen de cada coordinadora (pedido del 19 oct 2026): la pieza que
//  hace la coordinación para anunciar la reunión en el grupo, una por
//  reunión (Entrega de Pasos / Sala de Reducción del Ego) y por modalidad.
//  La suben quienes programan; a la coordinadora le sale el día antes para
//  compartirla en WhatsApp con un mensaje.
//
//  Va en Firestore y no en el repositorio (que es público) ni en Storage
//  (el proyecto no tiene). Como un documento no pasa de 1 MB, la imagen va
//  reducida a JPEG y aparte de su ficha, para que la lista no baje todas:
//    imagenes_coordinadoras/{id}                ficha: quién, reunión, modalidad
//    imagenes_coordinadoras/{id}/archivo/actual  la imagen (base64)
//  Solo la ve el equipo.
// ---------------------------------------------------------------------------

export interface FichaImagen {
  id: string;
  coordinadora: string;
  tipo: SessionType;
  modalidad: Modality;
  /** Cambia cada vez que se sube otra: sirve para no mostrar la vieja guardada. */
  version: string;
}

const col = collection(db, 'imagenes_coordinadoras');

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** "Jessica Becerra" + Sala + virtual → "jessica-becerra__reduccion_ego__virtual". */
export const idImagen = (coordinadora: string, tipo: SessionType, modalidad: Modality) =>
  `${slug(coordinadora)}__${tipo}__${modalidad}`;

export function listenImagenes(onData: (m: Map<string, FichaImagen>) => void, onError: (e: Error) => void) {
  return onSnapshot(
    col,
    (snap) => {
      const m = new Map<string, FichaImagen>();
      for (const d of snap.docs) m.set(d.id, { ...(d.data() as Omit<FichaImagen, 'id'>), id: d.id });
      onData(m);
    },
    onError,
  );
}

/**
 * La imagen como data URL, o null si no hay. Primero lo guardado en el
 * teléfono (sirve sin señal); si no está o es de otra versión, del servidor.
 */
export async function leerImagen(id: string, version?: string): Promise<string | null> {
  const ref = doc(col, id, 'archivo', 'actual');
  const aUrl = (datos: unknown) => (typeof datos === 'string' && datos ? `data:image/jpeg;base64,${datos}` : null);
  try {
    const guardada = await getDocFromCache(ref);
    if (guardada.exists() && (!version || guardada.get('version') === version)) return aUrl(guardada.get('datos'));
  } catch {
    /* no estaba guardada en el teléfono */
  }
  const s = await getDoc(ref);
  return s.exists() ? aUrl(s.get('datos')) : null;
}

export function guardarImagen(
  coordinadora: string,
  tipo: SessionType,
  modalidad: Modality,
  datosBase64: string,
  user: UserProfile,
) {
  const id = idImagen(coordinadora, tipo, modalidad);
  const version = `${Date.now().toString(36)}`;
  const b = writeBatch(db);
  b.set(doc(col, id), {
    coordinadora,
    tipo,
    modalidad,
    version,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  b.set(doc(col, id, 'archivo', 'actual'), { datos: datosBase64, version });
  return b.commit();
}

export function borrarImagen(id: string) {
  const b = writeBatch(db);
  b.delete(doc(col, id, 'archivo', 'actual'));
  b.delete(doc(col, id));
  return b.commit();
}
