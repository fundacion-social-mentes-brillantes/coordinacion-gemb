import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  completarConfig,
  type DiaProgramado,
  type EnlacesMeet,
  type ProgramacionConfig,
  type SolicitudApartado,
} from '../lib/programacion';
import type { UserProfile } from '../types';

// La programación (el antiguo Calendario) vive en tres colecciones:
//   programacion/config        cómo es cada semana, la temporada y el equipo
//   programacion_dias/{día}     lo que se cambió a mano ese día (quién
//                               coordina, modalidad, si no hay reunión…)
//   programacion_solicitudes/{día}  pedidos viejos de "Apartar" (ya no se crean)
// Las tres se leen sin iniciar sesión: el calendario es público, como antes.
//
// Quién cambió por última vez la configuración o un día NO va en esos
// documentos públicos (pedido de Sebastián, 17 oct 2026): va aparte, en
//   programacion_cambios/{día o "config"}   quién y cuándo (solo el equipo)
// y se escribe en el mismo lote que el cambio.

const configRef = doc(db, 'programacion', 'config');
/** Los enlaces de Meet: aparte de la configuración porque NO son públicos. */
const enlacesRef = doc(db, 'programacion', 'enlaces');
const diasCol = collection(db, 'programacion_dias');
const solicitudesCol = collection(db, 'programacion_solicitudes');
const cambiosCol = collection(db, 'programacion_cambios');

export function listenConfig(
  onData: (c: ProgramacionConfig, existe: boolean) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    configRef,
    (snap) => onData(completarConfig(snap.data() as Partial<ProgramacionConfig>), snap.exists()),
    onError,
  );
}

export function listenDias(
  onData: (dias: Map<string, DiaProgramado>) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    diasCol,
    (snap) => {
      const m = new Map<string, DiaProgramado>();
      for (const d of snap.docs) m.set(d.id, { ...(d.data() as Omit<DiaProgramado, 'id'>), id: d.id });
      onData(m);
    },
    onError,
  );
}

export function listenSolicitudes(
  onData: (s: Map<string, SolicitudApartado>) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    solicitudesCol,
    (snap) => {
      const m = new Map<string, SolicitudApartado>();
      for (const d of snap.docs) {
        const x = d.data() as Omit<SolicitudApartado, 'id'>;
        if (x.estado === 'pendiente') m.set(d.id, { ...x, id: d.id });
      }
      onData(m);
    },
    onError,
  );
}

/** Quién lo hizo. Solo en documentos que lee el equipo. */
const firma = (user: UserProfile) => ({
  updatedAt: serverTimestamp(),
  updatedBy: user.uid,
  updatedByName: user.displayName || user.email,
});

/**
 * Para un día público: cuándo, sin quién. Borra la firma que hubiera quedado
 * de antes (se escribía en el propio día y se veía sin entrar).
 */
const sello = () => ({
  updatedAt: serverTimestamp(),
  updatedBy: deleteField(),
  updatedByName: deleteField(),
});

/** El cambio público y, en el mismo lote, quién lo hizo (para el equipo). */
function conFirma(id: string, user: UserProfile, escribir: (b: WriteBatch) => void) {
  const b = writeBatch(db);
  escribir(b);
  b.set(doc(cambiosCol, id), firma(user));
  return b.commit();
}

export function guardarConfig(c: ProgramacionConfig, user: UserProfile) {
  return conFirma('config', user, (b) => b.set(configRef, { ...c, updatedAt: serverTimestamp() }));
}

/** Los enlaces fijos de Meet de cada reunión (solo con sesión iniciada). */
export function listenEnlaces(onData: (e: EnlacesMeet) => void, onError: (e: Error) => void) {
  return onSnapshot(
    enlacesRef,
    (snap) => onData(((snap.data() ?? {}).meet ?? {}) as EnlacesMeet),
    onError,
  );
}

export function guardarEnlaces(meet: EnlacesMeet, user: UserProfile) {
  return setDoc(enlacesRef, { meet, ...firma(user) });
}

/**
 * Cambia lo que se indique de un día. `null` en un campo lo borra (vuelve a
 * lo normal para ese campo).
 */
export function guardarDia(
  key: string,
  cambios: {
    [K in keyof Omit<DiaProgramado, 'id' | 'updatedByName' | 'coordinadoraUid'>]?: DiaProgramado[K] | null;
  },
  user: UserProfile,
  /** Quién coordinaba antes: si cambia, se borra quién se la había tomado. */
  coordinadoraAntes?: string,
) {
  const datos: Record<string, unknown> = { ...sello() };
  for (const [k, v] of Object.entries(cambios)) datos[k] = v === null ? deleteField() : v;
  if ('coordinadora' in cambios && (cambios.coordinadora ?? '') !== (coordinadoraAntes ?? '')) {
    datos.coordinadoraUid = deleteField();
  }
  return conFirma(key, user, (b) => b.set(doc(diasCol, key), datos, { merge: true }));
}

/**
 * "Yo la coordino": se pone ella misma en una fecha libre, al instante.
 * Las reglas exigen que siga libre, que el nombre sea del equipo y que la
 * marca sea su propia cuenta; si otra llegó primero, falla (permiso).
 */
export function tomarFecha(key: string, nombre: string, user: UserProfile) {
  return conFirma(key, user, (b) =>
    b.set(doc(diasCol, key), { coordinadora: nombre, coordinadoraUid: user.uid, ...sello() }, { merge: true }),
  );
}

/** "Soltar": deja libre la fecha que ella misma se tomó. */
export function soltarFecha(key: string, user: UserProfile) {
  return conFirma(key, user, (b) =>
    b.set(doc(diasCol, key), { coordinadora: deleteField(), coordinadoraUid: deleteField(), ...sello() }, { merge: true }),
  );
}

/** Ese día vuelve a ser como dice la regla (sin cambios a mano). */
export function restaurarDia(key: string) {
  return deleteDoc(doc(diasCol, key));
}

/**
 * Solicitudes de "Apartar" que quedaron del Calendario viejo (ya no se crean:
 * ahora cada una se toma la fecha con "Yo la coordino").
 * Aceptar: la fecha queda asignada a quien la pidió.
 */
export function atenderSolicitud(key: string, nombre: string, user: UserProfile) {
  const b = writeBatch(db);
  b.set(
    doc(diasCol, key),
    { coordinadora: nombre, coordinadoraUid: deleteField(), ...firma(user) },
    { merge: true },
  );
  b.delete(doc(solicitudesCol, key));
  return b.commit();
}

/** Rechazar: la fecha vuelve a quedar libre para que otra persona la pida. */
export function rechazarSolicitud(key: string) {
  return deleteDoc(doc(solicitudesCol, key));
}
