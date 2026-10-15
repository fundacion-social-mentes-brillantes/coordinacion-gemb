import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { createSession } from '../services/sessions';
import { fromInputDate } from '../lib/dates';
import type { FechaPlan } from '../lib/programacion';
import type { Session, SessionType } from '../types';

/**
 * "Tomar asistencia" de una reunión del calendario. Las reuniones ya están
 * "creadas": si todavía no tiene lista, se crea en ese momento con lo que dice
 * el calendario (modalidad y quién coordina) y se abre. El id es el del día
 * ("entrega_pasos-2026-10-16"), así que si dos coordinadoras tocan a la vez
 * caen en la misma lista.
 */
export function useAbrirReunion() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  return useCallback(
    (p: FechaPlan, type: SessionType, existente?: Session) => {
      if (existente) {
        navigate(`/sesiones/${existente.id}`);
        return;
      }
      if (!profile) return;
      const { id, done } = createSession(
        {
          type,
          modality: p.modalidad,
          date: fromInputDate(p.key),
          coordinator: p.coordinadora,
        },
        profile,
      );
      done.catch((e) => {
        console.error(e);
        // Rechazada = otra la abrió un instante antes: la pantalla ya está en
        // esa misma lista (mismo id).
        if ((e as { code?: string })?.code !== 'permission-denied') {
          toast('No se pudo abrir la lista. Revisa la conexión.', 'error');
        }
      });
      navigate(`/sesiones/${id}`);
    },
    [profile, navigate, toast],
  );
}
