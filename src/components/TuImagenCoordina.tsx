import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { useRecursosReunion } from '../hooks/useRecursosReunion';
import type { EstadoProgramacion } from '../hooks/useProgramacion';
import { SESSION_TYPE_LABELS, MODALITY_LABELS } from '../lib/constants';
import { downloadBlob } from '../lib/export';
import { blobDeJpeg } from '../lib/reducirImagen';
import { mensajeCoordina } from '../lib/mensajesCoordina';
import { copiarTexto } from '../lib/nativo';
import { NOMBRES_DIA, hayReunion, moverDia, planDeFecha, type FechaPlan } from '../lib/programacion';
import { shareOrDownloadImage } from '../lib/shareImage';
import { idImagen, leerImagen } from '../services/imagenesCoordinadoras';
import type { SessionType } from '../types';
import { CopyIcon, DownloadIcon, RefreshIcon, ShareIcon } from './Icons';
import { Spinner } from './Spinner';

// ---------------------------------------------------------------------------
//  «Mañana coordinas tú» (pedido del 19 oct 2026). El día antes de su
//  reunión —y el mismo día, hasta la noche— a la coordinadora le sale arriba
//  de Asistencia su imagen (la que subió la coordinación para esa reunión y
//  modalidad) con un mensaje listo, para mandarlo al grupo de WhatsApp de un
//  toque. El mensaje cambia cada vez para que no salgan todos iguales.
// ---------------------------------------------------------------------------

interface Turno {
  p: FechaPlan;
  tipo: SessionType;
  esHoy: boolean;
}

/** Su próxima reunión si es hoy (antes de las 7 p. m.) o mañana. */
function turnoDe(prog: EstadoProgramacion, miNombre: string, hoyKey: string): Turno | null {
  if (!miNombre || prog.cargando) return null;
  const opciones: [string, boolean][] = [];
  if (new Date().getHours() < 19) opciones.push([hoyKey, true]);
  opciones.push([moverDia(hoyKey, 1), false]);
  for (const [key, esHoy] of opciones) {
    const p = planDeFecha(key, prog.config, prog.dias);
    if (p && hayReunion(p) && p.coordinadora === miNombre) {
      return { p, tipo: p.actividades[0] ?? 'reduccion_ego', esHoy };
    }
  }
  return null;
}

export function TuImagenCoordina({
  prog,
  miNombre,
  hoyKey,
}: {
  prog: EstadoProgramacion;
  miNombre: string;
  hoyKey: string;
}) {
  const turno = useMemo(() => turnoDe(prog, miNombre, hoyKey), [prog, miNombre, hoyKey]);
  if (!turno) return null;
  return <Tarjeta turno={turno} miNombre={miNombre} />;
}

function Tarjeta({ turno, miNombre }: { turno: Turno; miNombre: string }) {
  const { p, tipo, esHoy } = turno;
  const { toast } = useToast();
  const { meet } = useRecursosReunion();
  const [imagen, setImagen] = useState<string | null | undefined>(undefined);
  const [vuelta, setVuelta] = useState(0);
  const blob = useRef<Blob | null>(null);
  const id = idImagen(miNombre, tipo, p.modalidad);

  useEffect(() => {
    let vivo = true;
    setImagen(undefined);
    leerImagen(id)
      .then((url) => {
        if (!vivo) return;
        blob.current = url ? blobDeJpeg(url) : null;
        setImagen(url);
      })
      .catch((e) => {
        console.warn('No se pudo leer la imagen de la coordinadora', e);
        if (vivo) setImagen(null);
      });
    return () => {
      vivo = false;
    };
  }, [id]);

  const mensaje = mensajeCoordina(p, tipo, { esHoy, vuelta, enlace: meet[tipo], nombre: miNombre });
  const nombreArchivo = `${SESSION_TYPE_LABELS[tipo]} - ${NOMBRES_DIA[p.diaSemana]} ${p.fecha.getUTCDate()} - ${miNombre}.jpg`;

  // Se llama justo con el toque: el iPhone no abre el menú si se espera antes.
  const compartir = async () => {
    if (!blob.current) {
      // Sin imagen: el mensaje solo, directo a WhatsApp.
      window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, '_blank', 'noopener');
      return;
    }
    const r = await shareOrDownloadImage(blob.current, nombreArchivo, mensaje);
    if (r === 'downloaded' || r === 'opened') toast('Imagen guardada. Copia el mensaje y mándalo con ella.', 'info');
    else if (r === 'error') toast('No se pudo compartir. Prueba con «Descargar».', 'error');
  };

  const copiar = async () => {
    try {
      await copiarTexto(mensaje);
      toast('Mensaje copiado: pégalo en el grupo.', 'success');
    } catch {
      window.prompt('Copia el mensaje:', mensaje);
    }
  };

  return (
    <section className="recursos p-4" aria-label={esHoy ? 'Hoy coordinas tú' : 'Mañana coordinas tú'}>
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#d6b064]">
        {esHoy ? 'Hoy coordinas tú' : 'Mañana coordinas tú'} ✨
      </p>
      <p className="mt-1 font-semibold text-slate-900">
        {SESSION_TYPE_LABELS[tipo]} · {NOMBRES_DIA[p.diaSemana].toLowerCase()} {p.fecha.getUTCDate()} ·{' '}
        {MODALITY_LABELS[p.modalidad].toLowerCase()}
      </p>
      <p className="text-xs text-slate-500">Manda tu imagen al grupo con este mensaje.</p>

      <div className="mt-3">
        {imagen === undefined ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner className="h-7 w-7" />
          </div>
        ) : imagen ? (
          <img src={imagen} alt={`Imagen de ${miNombre} para la reunión`} className="mx-auto w-full max-w-sm rounded-2xl" />
        ) : (
          <p className="rounded-2xl bg-[rgba(255,255,255,0.05)] p-3 text-sm text-slate-500">
            Tu imagen para esta reunión todavía no está en la app. Pídesela a la coordinación; mientras
            tanto puedes mandar el mensaje.
          </p>
        )}
      </div>

      <div className="mt-3 rounded-2xl bg-[rgba(255,255,255,0.05)] p-3">
        <p className="whitespace-pre-line text-sm text-slate-700">{mensaje}</p>
        <button
          type="button"
          onClick={() => setVuelta((v) => v + 1)}
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600"
        >
          <RefreshIcon className="text-base" /> Otro mensaje
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void compartir()}
          disabled={imagen === undefined}
          className="col-span-2 inline-flex min-h-[50px] items-center justify-center gap-2 rounded-full bg-[#1fa855] px-4 font-semibold text-white disabled:opacity-60"
        >
          <ShareIcon className="text-lg" /> Compartir en WhatsApp
        </button>
        <button
          type="button"
          onClick={() => blob.current && void downloadBlob(blob.current, nombreArchivo, 'image/jpeg')}
          disabled={!imagen}
          className="btn-secondary min-h-[46px] text-sm disabled:opacity-50"
        >
          <DownloadIcon className="text-lg" /> Descargar
        </button>
        <button type="button" onClick={() => void copiar()} className="btn-secondary min-h-[46px] text-sm">
          <CopyIcon className="text-lg" /> Copiar mensaje
        </button>
      </div>
    </section>
  );
}
