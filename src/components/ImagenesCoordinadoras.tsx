import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { MODALITY_LABELS, SESSION_TYPE_LABELS } from '../lib/constants';
import { reducirImagen } from '../lib/reducirImagen';
import {
  borrarImagen,
  guardarImagen,
  idImagen,
  leerImagen,
  listenImagenes,
  type FichaImagen,
} from '../services/imagenesCoordinadoras';
import type { Modality, SessionType } from '../types';
import { CheckIcon, PlusIcon } from './Icons';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

// ---------------------------------------------------------------------------
//  Donde quien programa sube la imagen de cada coordinadora (19 oct 2026):
//  una por reunión y modalidad. Quien solo hace Sala deja vacías las de
//  Pasos. Las casillas no bajan las imágenes (pesan): se ven al tocarlas.
// ---------------------------------------------------------------------------

const CASILLAS: { tipo: SessionType; modalidad: Modality; corto: string }[] = [
  { tipo: 'reduccion_ego', modalidad: 'virtual', corto: 'Sala · Virtual' },
  { tipo: 'reduccion_ego', modalidad: 'presencial', corto: 'Sala · Presencial' },
  { tipo: 'entrega_pasos', modalidad: 'virtual', corto: 'Pasos · Virtual' },
  { tipo: 'entrega_pasos', modalidad: 'presencial', corto: 'Pasos · Presencial' },
];

interface Elegida {
  coordinadora: string;
  tipo: SessionType;
  modalidad: Modality;
}

export function ImagenesCoordinadoras({ equipo, onClose }: { equipo: string[]; onClose: () => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [fichas, setFichas] = useState<Map<string, FichaImagen> | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [ver, setVer] = useState<Elegida | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const destino = useRef<Elegida | null>(null);

  useEffect(
    () =>
      listenImagenes(setFichas, (e) => {
        console.error(e);
        toast('No se pudieron leer las imágenes.', 'error');
      }),
    [toast],
  );

  const pedirArchivo = (e: Elegida) => {
    destino.current = e;
    entrada.current?.click();
  };

  const alElegir = async (archivo: File | undefined) => {
    const d = destino.current;
    if (!archivo || !d || !profile) return;
    const id = idImagen(d.coordinadora, d.tipo, d.modalidad);
    setSubiendo(id);
    try {
      const datos = await reducirImagen(archivo);
      await guardarImagen(d.coordinadora, d.tipo, d.modalidad, datos, profile);
      toast(`Imagen de ${d.coordinadora} guardada.`, 'success');
      setVer(null);
    } catch (e) {
      console.error(e);
      toast((e as Error).message || 'No se pudo guardar la imagen.', 'error');
    } finally {
      setSubiendo(null);
      if (entrada.current) entrada.current.value = '';
    }
  };

  return (
    <Modal open onClose={onClose} title="Imágenes de las coordinadoras">
      <p className="mb-4 text-sm text-slate-500">
        La imagen de cada coordinadora para anunciar su reunión. El día antes le sale en Asistencia,
        lista para mandarla al grupo de WhatsApp con un mensaje.
      </p>
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void alElegir(e.target.files?.[0])}
      />
      {!fichas ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-7 w-7" />
        </div>
      ) : equipo.length === 0 ? (
        <p className="text-sm text-slate-500">Primero agrega el equipo en los ajustes del calendario.</p>
      ) : (
        <ul className="space-y-3">
          {equipo.map((nombre) => (
            <li key={nombre} className="card p-3">
              <p className="mb-2 font-semibold text-slate-900">{nombre}</p>
              <div className="grid grid-cols-2 gap-2">
                {CASILLAS.map(({ tipo, modalidad, corto }) => {
                  const id = idImagen(nombre, tipo, modalidad);
                  const hay = fichas.has(id);
                  const e = { coordinadora: nombre, tipo, modalidad };
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => (hay ? setVer(e) : pedirArchivo(e))}
                      disabled={subiendo === id}
                      className={`flex min-h-[52px] items-center justify-center gap-1.5 rounded-2xl px-2 text-xs font-semibold ${
                        hay
                          ? 'border border-[rgba(214,176,100,0.5)] bg-[rgba(214,176,100,0.16)] text-[#ebd29c]'
                          : 'border border-dashed border-[rgba(255,255,255,0.18)] text-slate-500'
                      }`}
                    >
                      {subiendo === id ? (
                        <Spinner className="h-4 w-4" />
                      ) : hay ? (
                        <CheckIcon className="text-base" />
                      ) : (
                        <PlusIcon className="text-base" />
                      )}
                      {corto}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      {ver && (
        <VerImagen
          elegida={ver}
          version={fichas?.get(idImagen(ver.coordinadora, ver.tipo, ver.modalidad))?.version}
          subiendo={subiendo !== null}
          onCambiar={() => pedirArchivo(ver)}
          onQuitar={async () => {
            try {
              await borrarImagen(idImagen(ver.coordinadora, ver.tipo, ver.modalidad));
              toast('Imagen quitada.', 'success');
              setVer(null);
            } catch (e) {
              console.error(e);
              toast('No se pudo quitar la imagen.', 'error');
            }
          }}
          onClose={() => setVer(null)}
        />
      )}
    </Modal>
  );
}

function VerImagen({
  elegida,
  version,
  subiendo,
  onCambiar,
  onQuitar,
  onClose,
}: {
  elegida: Elegida;
  version?: string;
  subiendo: boolean;
  onCambiar: () => void;
  onQuitar: () => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const { coordinadora, tipo, modalidad } = elegida;

  useEffect(() => {
    let vivo = true;
    leerImagen(idImagen(coordinadora, tipo, modalidad), version)
      .then((u) => vivo && setUrl(u))
      .catch(() => vivo && setUrl(null));
    return () => {
      vivo = false;
    };
  }, [coordinadora, tipo, modalidad, version]);

  return (
    <Modal open onClose={onClose} title={coordinadora}>
      <p className="mb-3 text-sm text-slate-500">
        {SESSION_TYPE_LABELS[tipo]} · {MODALITY_LABELS[modalidad]}
      </p>
      {url === undefined ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-7 w-7" />
        </div>
      ) : url ? (
        <img src={url} alt={`${coordinadora} · ${SESSION_TYPE_LABELS[tipo]}`} className="w-full rounded-2xl" />
      ) : (
        <p className="text-sm text-slate-500">No se pudo abrir la imagen.</p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={onCambiar} disabled={subiendo} className="btn-primary min-h-[48px]">
          {subiendo ? <Spinner className="h-4 w-4" /> : 'Cambiar'}
        </button>
        <button type="button" onClick={onQuitar} disabled={subiendo} className="btn-secondary min-h-[48px]">
          Quitar
        </button>
      </div>
    </Modal>
  );
}
