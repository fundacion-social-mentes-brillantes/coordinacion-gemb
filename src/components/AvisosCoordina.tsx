import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ajustesDeAvisos, enAppAndroid } from '../lib/nativo';
import {
  activarAvisos,
  apagarAvisos,
  ErrorAvisos,
  estadoAvisos,
  mantenerAvisos,
  probarAviso,
  type EstadoAvisos,
} from '../services/avisos';
import { URL_APP_ANDROID } from './Burbuja';
import { BellIcon, CheckIcon, XIcon } from './Icons';
import { Spinner } from './Spinner';

// ---------------------------------------------------------------------------
//  «Avisarme el día antes de coordinar» (pedido del 19 oct 2026).
//  - <AvisosCoordina/>  en Ajustes: el estado y los botones.
//  - <InvitarAvisos/>   en Asistencia: la invitación, solo mientras estén
//                       apagados y no haya dicho «Ahora no».
//  Lo de cada teléfono (Android, iPhone, navegador) está en services/avisos.
// ---------------------------------------------------------------------------

function useAvisos(miNombre: string) {
  const { profile } = useAuth();
  const uid = profile?.uid ?? '';
  const [estado, setEstado] = useState<EstadoAvisos | null>(null);

  const refrescar = useCallback(() => {
    if (!uid) return;
    estadoAvisos(uid)
      .then(setEstado)
      .catch(() => setEstado('sin-soporte'));
  }, [uid]);

  useEffect(() => {
    refrescar();
    // Al volver de los ajustes del teléfono, el permiso pudo cambiar.
    const alVolver = () => document.visibilityState === 'visible' && refrescar();
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, [refrescar]);

  // Token nuevo u otro nombre: se pone al día solo.
  useEffect(() => {
    if (uid && miNombre) mantenerAvisos(uid, miNombre).catch((e) => console.warn('avisos: no se pudo poner al día', e));
  }, [uid, miNombre]);

  return { uid, estado, setEstado, refrescar };
}

/** Activar con el toque (el iPhone solo pregunta el permiso así). */
function useActivar(uid: string, miNombre: string, alTerminar: (e: EstadoAvisos) => void) {
  const { toast } = useToast();
  const [ocupado, setOcupado] = useState(false);
  const activar = () => {
    setOcupado(true);
    activarAvisos(uid, miNombre)
      .then(() => {
        alTerminar('activos');
        toast('¡Listo! Te aviso el día antes de coordinar.', 'success');
      })
      .catch((e) => {
        console.warn('avisos: no se pudieron activar', e);
        if (e instanceof ErrorAvisos) {
          if (e.estado !== 'version-vieja') alTerminar(e.estado);
          toast(e.message, e.estado === 'version-vieja' ? 'info' : 'error');
        } else toast('No se pudieron activar los avisos. Inténtalo de nuevo.', 'error');
      })
      .finally(() => setOcupado(false));
  };
  return { activar, ocupado };
}

export function AvisosCoordina({ miNombre }: { miNombre: string }) {
  const { toast } = useToast();
  const { uid, estado, setEstado } = useAvisos(miNombre);
  const { activar, ocupado } = useActivar(uid, miNombre, setEstado);
  const [probando, setProbando] = useState(false);

  const probar = async () => {
    setProbando(true);
    try {
      const r = await probarAviso();
      if (r.enviados > 0) toast('Aviso enviado: te debe llegar en unos segundos.', 'success');
      else toast('No llegó a ningún teléfono. Apaga y vuelve a activar los avisos.', 'error');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setProbando(false);
    }
  };

  const apagar = async () => {
    try {
      await apagarAvisos(uid);
      setEstado('apagados');
      toast('Avisos apagados en este teléfono.', 'success');
    } catch (e) {
      console.warn(e);
      toast('No se pudieron apagar. Inténtalo de nuevo.', 'error');
    }
  };

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-start gap-3">
        <BellIcon className="mt-0.5 shrink-0 text-2xl text-[#d6b064]" />
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">Aviso el día antes de coordinar</p>
          <p className="text-sm text-slate-500">
            A las 9 de la mañana del día antes te llega un aviso para mandar tu imagen al grupo.
          </p>
        </div>
      </div>

      {!miNombre ? (
        <p className="text-sm text-slate-500">
          Es para quien coordina. Si coordinas, elige tu nombre en Coordinación («Yo la coordino»).
        </p>
      ) : estado === null ? (
        <div className="flex justify-center py-2">
          <Spinner className="h-5 w-5" />
        </div>
      ) : estado === 'activos' ? (
        <>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(214,176,100,0.16)] px-3 py-1 text-xs font-bold text-[#ebd29c]">
            <CheckIcon /> Activos en este teléfono · {miNombre}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void probar()} disabled={probando} className="btn-primary min-h-[46px] text-sm">
              {probando ? <Spinner className="h-4 w-4" /> : 'Probar aviso'}
            </button>
            <button type="button" onClick={() => void apagar()} className="btn-secondary min-h-[46px] text-sm">
              Apagar
            </button>
          </div>
        </>
      ) : estado === 'apagados' ? (
        <button type="button" onClick={activar} disabled={ocupado} className="btn-primary min-h-[48px] w-full">
          {ocupado ? <Spinner className="h-4 w-4" /> : 'Activar avisos'}
        </button>
      ) : estado === 'bloqueados' ? (
        <div className="space-y-2 text-sm text-slate-600">
          <p>Los avisos de la app están bloqueados en este teléfono.</p>
          {enAppAndroid ? (
            <button type="button" onClick={() => void ajustesDeAvisos().catch(() => {})} className="btn-secondary min-h-[46px] w-full text-sm">
              Abrir los ajustes de avisos
            </button>
          ) : (
            <p className="text-slate-500">
              Actívalos en los ajustes del teléfono (en iPhone: Ajustes → Notificaciones → Coordinación GEMB) y
              vuelve aquí.
            </p>
          )}
          <button type="button" onClick={activar} disabled={ocupado} className="btn-ghost min-h-[44px] w-full text-sm">
            Ya los activé: probar de nuevo
          </button>
        </div>
      ) : estado === 'instalar-ios' ? (
        <div className="rounded-2xl bg-[rgba(255,255,255,0.05)] p-3 text-sm text-slate-600">
          <p className="font-semibold">📲 En iPhone, primero agrega la app a la pantalla de inicio</p>
          <p className="mt-1">
            En Safari toca <strong>Compartir</strong> (el cuadrito con la flecha ↑) y luego{' '}
            <strong>«Agregar a inicio»</strong>. Abre la app desde ese ícono y vuelve aquí a activar los avisos.
          </p>
        </div>
      ) : estado === 'actualizar-app' ? (
        <div className="space-y-2 text-sm text-slate-600">
          <p>Para recibir avisos, actualiza la app «Coordinación GEMB» desde Google Play (versión 1.0.4 o más nueva).</p>
          <a href={URL_APP_ANDROID} target="_blank" rel="noopener" className="btn-secondary min-h-[46px] w-full text-sm">
            Abrir Google Play
          </a>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Este navegador no puede mostrar avisos. Usa la app de Android o, en iPhone, agrégala a la pantalla de inicio.
        </p>
      )}
    </div>
  );
}

const AHORA_NO = 'gemb:avisos-ahora-no';
const DIAS_SIN_INSISTIR = 21;

function dijoAhoraNo(): boolean {
  try {
    const t = Number(localStorage.getItem(AHORA_NO) ?? 0);
    return Date.now() - t < DIAS_SIN_INSISTIR * 86_400_000;
  } catch {
    return false;
  }
}

/** En Asistencia: «¿Te aviso el día antes de coordinar?», mientras estén apagados. */
export function InvitarAvisos({ miNombre }: { miNombre: string }) {
  const { uid, estado, setEstado } = useAvisos(miNombre);
  const { activar, ocupado } = useActivar(uid, miNombre, setEstado);
  const [oculto, setOculto] = useState(dijoAhoraNo);

  if (!miNombre || estado !== 'apagados' || oculto) return null;

  const ahoraNo = () => {
    try {
      localStorage.setItem(AHORA_NO, String(Date.now()));
    } catch {
      /* se vuelve a ofrecer la próxima vez */
    }
    setOculto(true);
  };

  return (
    <section className="card flex items-center gap-3 p-3" aria-label="Avisos del día antes">
      <BellIcon className="shrink-0 text-2xl text-[#d6b064]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">¿Te aviso el día antes de coordinar?</p>
        <p className="text-xs text-slate-500">Así mandas tu imagen al grupo a tiempo.</p>
      </div>
      <button type="button" onClick={activar} disabled={ocupado} className="btn-primary min-h-[40px] shrink-0 px-3 text-sm">
        {ocupado ? <Spinner className="h-4 w-4" /> : 'Sí, avísame'}
      </button>
      <button type="button" onClick={ahoraNo} aria-label="Ahora no" className="shrink-0 p-1 text-slate-400">
        <XIcon className="text-lg" />
      </button>
    </section>
  );
}
