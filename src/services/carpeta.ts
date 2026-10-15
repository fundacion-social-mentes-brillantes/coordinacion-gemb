import {
  collection,
  doc,
  getDocs,
  getDocsFromCache,
  onSnapshot,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

// ---------------------------------------------------------------------------
//  La carpeta de coordinación (el guion de cada reunión).
//
//  No es un archivo público: vive en Firestore, así solo la ve el equipo y
//  queda guardada en el teléfono para abrirla aunque no haya señal en plena
//  reunión. Firestore no admite documentos de más de 1 MB, por eso va en
//  partes:
//    carpeta/actual              versión, nombre, cuántas páginas y partes
//    carpeta/actual/paginas/{n}  cada página como imagen (para leerla)
//    carpeta/actual/pdf/{n}      el PDF partido en trozos (para compartirlo)
//  La sube la administración con la llave de servicio
//  (scripts/subir-carpeta.py); desde la app solo se lee.
// ---------------------------------------------------------------------------

export interface CarpetaMeta {
  /** Cambia cada vez que se sube una carpeta nueva. */
  version: string;
  nombre: string;
  paginas: number;
  partesPdf: number;
  actualizada?: Timestamp;
}

const metaRef = doc(db, 'carpeta', 'actual');

export function listenCarpeta(
  onData: (m: CarpetaMeta | null) => void,
  onError: (e: Error) => void,
) {
  return onSnapshot(
    metaRef,
    (snap) => onData(snap.exists() ? (snap.data() as CarpetaMeta) : null),
    onError,
  );
}

type Parte = QueryDocumentSnapshot;

/**
 * Trae las partes de la versión actual: primero de lo guardado en el
 * teléfono (sin gastar datos ni depender de la señal) y, si falta algo o es
 * de una versión vieja, del servidor.
 */
async function partes(sub: 'paginas' | 'pdf', meta: CarpetaMeta, total: number): Promise<string[]> {
  const col = collection(db, 'carpeta', 'actual', sub);
  const completas = (docs: Parte[]) =>
    docs.length === total && docs.every((d) => d.get('version') === meta.version);
  const ordenar = (docs: Parte[]) =>
    [...docs].sort((a, b) => Number(a.get('n')) - Number(b.get('n'))).map((d) => String(d.get('datos')));

  try {
    const guardadas = await getDocsFromCache(col);
    if (completas(guardadas.docs)) return ordenar(guardadas.docs);
  } catch {
    /* todavía no hay nada guardado en el teléfono */
  }
  const s = await getDocs(col);
  if (!completas(s.docs)) {
    throw new Error(
      navigator.onLine === false
        ? 'Sin señal: la carpeta se descarga la primera vez con internet. Después se abre sin señal.'
        : 'La carpeta no se pudo descargar completa. Intenta de nuevo en un momento.',
    );
  }
  return ordenar(s.docs);
}

/** Las páginas, listas para mostrar como imágenes. */
export async function cargarPaginas(meta: CarpetaMeta): Promise<string[]> {
  const pags = await partes('paginas', meta, meta.paginas);
  return pags.map((b64) => `data:image/jpeg;base64,${b64}`);
}

/** El PDF completo, para compartirlo (WhatsApp) o descargarlo. */
export async function cargarPdf(meta: CarpetaMeta): Promise<Blob> {
  const b64 = (await partes('pdf', meta, meta.partesPdf)).join('');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
}

/** "Carpeta de coordinación.pdf" (sin caracteres raros para WhatsApp). */
export const nombrePdf = (meta: CarpetaMeta) =>
  `${(meta.nombre || 'Carpeta de coordinación').replace(/[\\/:*?"<>|]+/g, ' ').trim()}.pdf`;
