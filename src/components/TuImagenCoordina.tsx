import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { useRecursosReunion } from '../hooks/useRecursosReunion';
import type { EstadoProgramacion } from '../hooks/useProgramacion';
import { SESSION_TYPE_LABELS, MODALITY_LABELS } from '../lib/constants';
import { downloadBlob } from '../lib/export';
import { blobDeJpeg } from '../lib/reducirImagen';
import { mensajeCoordina } from '../lib/mensajesCoordina';
import { copiarTexto } from '../lib/nativo';
import { NOMBRES_DIA, deClave, hayReunion, moverDia, planDeFecha, type FechaPlan } from '../lib/programacion';
import { shareOrDownloadImage } from '../lib/shareImage';
import { idImagen, leerImagen } from '../services/imagenesCoordinadoras';
import type { SessionType } from '../types';
import { CopyIcon, DownloadIcon, ImageIcon, RefreshIcon, ShareIcon } from './Icons';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

// ---------------------------------------------------------------------------
//  «Mañana coordinas tú» (pedido del 19 oct 2026). El día antes de su
//  reunión —y el mismo día, hasta la noche— a la coordinadora le sale arriba
//  de Asistencia su imagen (la que subió la coordinación para esa reunión y
//  modalidad) con un mensaje listo, para mandarlo al grupo de WhatsApp de un
//  toque. El mensaje cambia cada vez para que no salgan todos iguales.
//
//  Desde el 27 oct 2026 la imagen se puede sacar también antes: si no
//  coordina hoy ni mañana, Asistencia muestra su próxima reunión con «Ver mi
//  imagen», y en el calendario cada día suyo tiene «Mi imagen para el grupo».
// ---------------------------------------------------------------------------

interface Turno {
  p: FechaPlan;
  tipo: SessionType;
  /** Cuántos días faltan (0 = hoy). */
  dias: number;
}

/** Días que van de `desde` a `hasta` (claves AAAA-MM-DD). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((deClave(hasta).getTime() - deClave(desde).getTime()) / 86_400_000);
}

const turno = (p: FechaPlan, dias: number): Turno => ({ p, tipo: p.actividades[0] ?? 'reduccion_ego', dias });

/** Su próxima reunión si es hoy (antes de las 7 p. m.) o mañana. */
function turnoDe(prog: EstadoProgramacion, miNombre: string, hoyKey: string): Turno | null {
  if (!miNombre || prog.cargando) return null;
  const opciones: [string, number][] = [];
  if (new Date().getHours() < 19) opciones.push([hoyKey, 0]);
  opciones.push([moverDia(hoyKey, 1), 1]);
  for (const [key, dias] of opciones) {
    const p = planDeFecha(key, prog.config, prog.dias);
    if (p && hayReunion(p) && p.coordinadora === miNombre) return turno(p, dias);
  }
  return null;
}

/** Su próxima reunión de pasado mañana en adelante (hasta dos meses). */
function proximoTurno(prog: EstadoProgramacion, miNombre: string, hoyKey: string): Turno | null {
  if (!miNombre || prog.cargando) return null;
  for (let n = 2; n <= 62; n++) {
    const p = planDeFecha(moverDia(hoyKey, n), prog.config, prog.dias);
    if (p && hayReunion(p) && p.coordinadora === miNombre) return turno(p, n);
  }
  return null;
}

const diaCorto = (p: FechaPlan) => `${NOMBRES_DIA[p.diaSemana]} ${p.fecha.getUTCDate()}`;

export function TuImagenCoordina({
  prog,
  miNombre,
  hoyKey,
}: {
  prog: EstadoProgramacion;
  miNombre: string;
  hoyKey: string;
}) {
  const cerca = useMemo(() => turnoDe(prog, miNombre, hoyKey), [prog, miNombre, hoyKey]);
  const despues = useMemo(() => (cerca ? null : proximoTurno(prog, miNombre, hoyKey)), [cerca, prog, miNombre, hoyKey]);
  if (cerca) return <TarjetaImagen p={cerca.p} tipo={cerca.tipo} dias={cerca.dias} nombre={miNombre} />;
  if (despues) return <ProximaTuya turno={despues} miNombre={miNombre} />;
  return null;
}

/** Cuando falta más: una línea con su próxima reunión y «Ver mi imagen». */
function ProximaTuya({ turno: t, miNombre }: { turno: Turno; miNombre: string }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <section className="card flex items-center gap-3 p-3" aria-label="Tu próxima reunión">
      <ImageIcon className="shrink-0 text-2xl text-[#d6b064]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">Tu próxima reunión: {diaCorto(t.p)}</p>
        <p className="truncate text-xs text-slate-500">
          {SESSION_TYPE_LABELS[t.tipo]} · {MODALITY_LABELS[t.p.modalidad].toLowerCase()}
        </p>
      </div>
      <button type="button" onClick={() => setAbierta(true)} className="btn-secondary min-h-[40px] shrink-0 px-3 text-sm">
        Ver mi imagen
      </button>
      {abierta && (
        <Modal open onClose={() => setAbierta(false)} title="Tu imagen para el grupo">
          <TarjetaImagen p={t.p} tipo={t.tipo} dias={t.dias} nombre={miNombre} />
        </Modal>
      )}
    </section>
  );
}

/** La imagen de `nombre` para la reunión `tipo` de la fecha `p`, con su mensaje y los botones. */
export function TarjetaImagen({
  p,
  tipo,
  dias,
  nombre,
}: {
  p: FechaPlan;
  tipo: SessionType;
  dias: number;
  nombre: string;
}) {
  const { toast } = useToast();
  const { meet } = useRecursosReunion();
  const [imagen, setImagen] = useState<string | null | undefined>(undefined);
  const [vuelta, setVuelta] = useState(0);
  const blob = useRef<Blob | null>(null);
  const id = idImagen(nombre, tipo, p.modalidad);

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

  const mensaje = mensajeCoordina(p, tipo, { dias, vuelta, enlace: meet[tipo], nombre });
  const nombreArchivo = `${SESSION_TYPE_LABELS[tipo]} - ${NOMBRES_DIA[p.diaSemana]} ${p.fecha.getUTCDate()} - ${nombre}.jpg`;
  const encabezado = dias === 0 ? 'Hoy coordinas tú' : dias === 1 ? 'Mañana coordinas tú' : `Coordinas el ${diaCorto(p).toLowerCase()}`;

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
    <section className="recursos p-4" aria-label={encabezado}>
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#d6b064]">{encabezado} ✨</p>
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
          <img src={imagen} alt={`Imagen de ${nombre} para la reunión`} className="mx-auto w-full max-w-sm rounded-2xl" />
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
