import { useEffect, useState } from 'react';
import { listenConfig, listenDias, listenSolicitudes } from '../services/programacion';
import {
  CONFIG_INICIAL,
  type DiaProgramado,
  type ProgramacionConfig,
  type SolicitudApartado,
} from '../lib/programacion';

export interface EstadoProgramacion {
  config: ProgramacionConfig;
  /** false hasta que exista programacion/config (antes de la migración). */
  configGuardada: boolean;
  dias: Map<string, DiaProgramado>;
  solicitudes: Map<string, SolicitudApartado>;
  cargando: boolean;
  error: boolean;
}

/**
 * La programación en vivo (configuración, cambios por día y solicitudes).
 * Funciona con o sin sesión iniciada: todo eso es de lectura pública.
 */
export function useProgramacion(opts: { conSolicitudes?: boolean } = {}): EstadoProgramacion {
  const conSolicitudes = opts.conSolicitudes ?? true;
  const [config, setConfig] = useState<ProgramacionConfig>(CONFIG_INICIAL);
  const [configGuardada, setConfigGuardada] = useState(false);
  const [dias, setDias] = useState<Map<string, DiaProgramado>>(new Map());
  const [solicitudes, setSolicitudes] = useState<Map<string, SolicitudApartado>>(new Map());
  const [listos, setListos] = useState({ config: false, dias: false });
  const [error, setError] = useState(false);

  useEffect(() => {
    const fallo = (e: Error) => {
      console.warn('No se pudo leer la programación', e);
      setError(true);
    };
    const u1 = listenConfig((c, existe) => {
      setConfig(c);
      setConfigGuardada(existe);
      setListos((l) => ({ ...l, config: true }));
    }, fallo);
    const u2 = listenDias((d) => {
      setDias(d);
      setListos((l) => ({ ...l, dias: true }));
    }, fallo);
    const u3 = conSolicitudes ? listenSolicitudes(setSolicitudes, fallo) : () => {};
    return () => {
      u1();
      u2();
      u3();
    };
  }, [conSolicitudes]);

  return {
    config,
    configGuardada,
    dias,
    solicitudes,
    cargando: !(listos.config && listos.dias) && !error,
    error,
  };
}
