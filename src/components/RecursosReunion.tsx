import { useEffect, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { useRecursosReunion } from '../hooks/useRecursosReunion';
import { cargarPaginas, cargarPdf, nombrePdf, type CarpetaMeta } from '../services/carpeta';
import { shareOrDownloadImage } from '../lib/shareImage';
import { SESSION_TYPES, SESSION_TYPE_LABELS } from '../lib/constants';
import type { SessionType } from '../types';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { CopyIcon, FolderIcon, ShareIcon, VideoIcon } from './Icons';
import { copiarTexto } from '../lib/nativo';

// ---------------------------------------------------------------------------
//  Lo que la coordinadora necesita a mano en la reunión, sin buscarlo en
//  otra pestaña (lo pidió la coordinación): la carpeta de coordinación y el
//  enlace de Meet de cada reunión, para entrar o copiarlo al grupo de
//  WhatsApp. Cada cosa es su propio botón de vidrio con su color, para
//  encontrarla de un vistazo: la carpeta en dorado y cada reunión con el
//  suyo (ver `.tile-recurso` en index.css).
// ---------------------------------------------------------------------------

/** El color de cada reunión (lo eligió la coordinación). */
const TONO: Record<SessionType, string> = {
  entrega_pasos: 'tono-rojo',
  reduccion_ego: 'tono-azul',
};

/** Copia un enlace; si el navegador no deja, lo muestra para copiarlo a mano. */
async function copiarEnlace(url: string): Promise<boolean> {
  try {
    await copiarTexto(url);
    return true;
  } catch {
    window.prompt('Copia el enlace:', url);
    return false;
  }
}

/** 'https://meet.google.com/abc-defg-hij' → 'abc-defg-hij' (lo que se ve en Meet). */
const codigoMeet = (url: string) =>
  url.replace(/^https?:\/\/(meet\.google\.com\/)?/, '').replace(/\?.*$/, '');

/** El recuadro completo (pantalla de Asistencia). */
export function RecursosReunion({ primero }: { primero?: SessionType }) {
  const { meet, carpeta } = useRecursosReunion();
  const { toast } = useToast();
  const [verCarpeta, setVerCarpeta] = useState(false);
  // La reunión de hoy, primero.
  const tipos = primero ? [primero, ...SESSION_TYPES.filter((t) => t !== primero)] : SESSION_TYPES;

  return (
    <section className="recursos p-3" aria-label="Para la reunión">
      <p className="px-2 pb-2 pt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
        Para la reunión
      </p>
      <ul className="space-y-2.5">
        <li>
          {/* La carpeta entera es el botón. */}
          <button
            type="button"
            className="tile-recurso tono-oro flex items-center gap-3"
            disabled={!carpeta}
            onClick={() => setVerCarpeta(true)}
          >
            <span className="icono-tile" aria-hidden>
              <FolderIcon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-slate-900">Carpeta de coordinación</span>
              <span className="block truncate text-xs text-slate-500">
                {carpeta ? 'El guion de la reunión · se abre sin señal' : 'Todavía no está cargada'}
              </span>
            </span>
            <span className="boton-tile" aria-hidden>
              Abrir
            </span>
          </button>
        </li>
        {tipos.map((t) => {
          const url = meet[t];
          return (
            <li key={t} className={`tile-recurso ${TONO[t]}`}>
              <div className="flex items-center gap-3">
                <span className="icono-tile" aria-hidden>
                  <VideoIcon />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight text-slate-900">{SESSION_TYPE_LABELS[t]}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {url ? `Meet · ${codigoMeet(url)}` : 'Sin enlace todavía'}
                  </p>
                </div>
              </div>
              {url && (
                <div className="mt-2.5 flex gap-2 pl-[52px]">
                  <button
                    type="button"
                    className="boton-tile-suave flex-1 whitespace-nowrap px-3"
                    aria-label={`Copiar el enlace de ${SESSION_TYPE_LABELS[t]}`}
                    onClick={async () => {
                      if (await copiarEnlace(url)) toast('Enlace copiado: pégalo en el grupo.', 'success');
                    }}
                  >
                    <CopyIcon className="text-lg" /> Copiar
                  </button>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="boton-tile flex-1 whitespace-nowrap">
                    <VideoIcon className="text-lg" /> Entrar
                  </a>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {verCarpeta && carpeta && <VisorCarpeta meta={carpeta} onClose={() => setVerCarpeta(false)} />}
    </section>
  );
}

/** La versión de una fila, para tenerla a mano dentro de la lista. */
export function RecursosReunionCompacto({ tipo }: { tipo: SessionType }) {
  const { meet, carpeta } = useRecursosReunion();
  const { toast } = useToast();
  const [verCarpeta, setVerCarpeta] = useState(false);
  const url = meet[tipo];
  if (!carpeta && !url) return null;

  return (
    <div className="flex items-center gap-2">
      {carpeta && (
        <button type="button" className="boton-tile-suave tono-oro flex-1 px-3" onClick={() => setVerCarpeta(true)}>
          <FolderIcon className="text-lg" /> Carpeta
        </button>
      )}
      {url && (
        <>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`boton-tile-suave ${TONO[tipo]} flex-1 px-3`}
          >
            <VideoIcon className="text-lg" /> Entrar a Meet
          </a>
          <button
            type="button"
            className={`boton-tile-suave ${TONO[tipo]}`}
            aria-label="Copiar el enlace de Meet"
            title="Copiar el enlace de Meet"
            onClick={async () => {
              if (await copiarEnlace(url)) toast('Enlace copiado: pégalo en el grupo.', 'success');
            }}
          >
            <CopyIcon className="text-lg" />
          </button>
        </>
      )}
      {verCarpeta && carpeta && <VisorCarpeta meta={carpeta} onClose={() => setVerCarpeta(false)} />}
    </div>
  );
}

/**
 * La carpeta, página por página, dentro de la app: se lee igual en iPhone,
 * Android y computador (un PDF no siempre se abre dentro del navegador del
 * celular). Se puede acercar con dos dedos y compartir el PDF al grupo.
 */
function VisorCarpeta({ meta, onClose }: { meta: CarpetaMeta; onClose: () => void }) {
  const { toast } = useToast();
  const [paginas, setPaginas] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const pdf = useRef<Blob | null>(null);

  useEffect(() => {
    let vivo = true;
    cargarPaginas(meta)
      .then((p) => vivo && setPaginas(p))
      .catch((e: Error) => {
        console.error(e);
        if (vivo) setError(e.message || 'No se pudo abrir la carpeta.');
      });
    return () => {
      vivo = false;
    };
  }, [meta]);

  const compartir = async () => {
    if (preparando) return;
    // La ruedita sigue hasta que el menú de compartir abre: un segundo toque
    // mientras tanto no prepara el PDF dos veces.
    setPreparando(true);
    try {
      let blob = pdf.current;
      if (!blob) {
        try {
          blob = await cargarPdf(meta);
          pdf.current = blob;
        } catch (e) {
          console.error(e);
          toast((e as Error).message || 'No se pudo preparar el PDF.', 'error');
          return;
        }
      }
      const r = await shareOrDownloadImage(blob, nombrePdf(meta), meta.nombre || 'Carpeta de coordinación');
      if (r === 'downloaded') toast('PDF descargado.', 'success');
      else if (r === 'blocked') toast('El PDF ya está listo: toca «Compartir» otra vez.', 'info');
      else if (r === 'error') toast('No se pudo compartir el PDF.', 'error');
    } finally {
      setPreparando(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={meta.nombre || 'Carpeta de coordinación'} completa>
      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={compartir} className="boton-oro">
          {preparando ? <Spinner className="h-4 w-4 text-[#261a00]" /> : <ShareIcon className="text-lg" />}
          Compartir PDF
        </button>
        <span className="text-xs text-slate-500">Acerca con dos dedos para leer mejor.</span>
      </div>
      {error ? (
        <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">{error}</p>
      ) : !paginas ? (
        <div className="flex flex-col items-center gap-3 py-20 text-sm text-slate-500">
          <Spinner className="h-8 w-8" />
          Abriendo la carpeta…
        </div>
      ) : (
        <div className="space-y-3">
          {paginas.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`Página ${i + 1} de ${paginas.length}`}
              className="w-full rounded-2xl bg-[#fff] shadow-[0_10px_30px_-18px_rgba(0,0,0,0.9)]"
              decoding="async"
              loading={i < 2 ? 'eager' : 'lazy'}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}
