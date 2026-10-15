import { useCallback, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { buscarEnEquipo } from '../lib/programacion';

// Para "Yo la coordino" hace falta saber cuál de los nombres del equipo es
// la persona que entró. Casi siempre sale solo de su nombre de Google; si no
// encaja (un apodo, otro apellido), lo elige una vez y se recuerda en este
// teléfono.

const clave = (uid: string) => `gemb:mi-nombre:${uid}`;

function leer(uid: string | undefined): string {
  if (!uid) return '';
  try {
    return localStorage.getItem(clave(uid)) ?? '';
  } catch {
    return '';
  }
}

export function useMiNombre(equipo: string[]) {
  const { profile } = useAuth();
  const uid = profile?.uid;
  const [guardado, setGuardado] = useState<{ uid?: string; nombre: string }>(() => ({
    uid,
    nombre: leer(uid),
  }));
  // Si cambia la cuenta, se vuelve a leer lo de esa cuenta.
  const elegido = guardado.uid === uid ? guardado.nombre : leer(uid);

  const automatico = profile ? buscarEnEquipo(profile.displayName || '', equipo) : '';
  const miNombre = elegido && equipo.includes(elegido) ? elegido : automatico;

  const elegirMiNombre = useCallback(
    (nombre: string) => {
      if (!uid) return;
      try {
        localStorage.setItem(clave(uid), nombre);
      } catch {
        /* sin almacenamiento: vale solo por ahora */
      }
      setGuardado({ uid, nombre });
    },
    [uid],
  );

  return { miNombre, elegirMiNombre };
}
