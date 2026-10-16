import { useEffect, useState } from 'react';
import { listenEnlaces } from '../services/programacion';
import { listenCarpeta, type CarpetaMeta } from '../services/carpeta';
import type { EnlacesMeet } from '../lib/programacion';
import { escucharConReintentos } from '../lib/reintentar';

/**
 * Lo que la coordinadora necesita a mano en la reunión: los enlaces de Meet
 * y la carpeta de coordinación. Solo con sesión iniciada (no son públicos):
 * con `activo = false` no se pide nada.
 */
export function useRecursosReunion(activo = true) {
  const [meet, setMeet] = useState<EnlacesMeet>({});
  const [carpeta, setCarpeta] = useState<CarpetaMeta | null>(null);

  useEffect(() => {
    if (!activo) return;
    const u1 = escucharConReintentos(
      (onError) => listenEnlaces(setMeet, onError),
      (e) => console.warn('No se pudieron leer los enlaces', e),
    );
    const u2 = escucharConReintentos(
      (onError) => listenCarpeta(setCarpeta, onError),
      (e) => console.warn('No se pudo leer la carpeta', e),
    );
    return () => {
      u1();
      u2();
    };
  }, [activo]);

  return { meet, carpeta };
}
