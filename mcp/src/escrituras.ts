import type { Cliente } from './rest';
import { AccesoError } from './rest';
import { normalizeText } from '../../src/lib/normalize';
import { SESSION_TYPE_LABELS, MODALITY_LABELS } from '../../src/lib/constants';
import { fmtDate, toDate } from '../../src/lib/dates';
import { TIPOS, type TipoCorto } from './informes';
import type { Modality, SessionType } from '../../src/types';

// ---------------------------------------------------------------------------
//  Escrituras: SOLO administración.
//
//  Todas van en dos pasos, como el MCP del ERP: primero se prepara un borrador
//  que no toca nada, y solo después de que la persona lo aprueba se ejecuta.
//  Escribir en la base de una fundación no es algo que deba pasar por un
//  malentendido en una frase.
//
//  El borrador viaja dentro del propio `confirmacion_id`, así que el servidor
//  no necesita recordar nada entre llamadas (se apaga entre una y otra). Eso
//  no debilita nada: quien puede confirmar es quien ya podía preparar, y las
//  reglas de Firestore siguen siendo la última palabra.
// ---------------------------------------------------------------------------

const VIGENCIA_MS = 15 * 60_000;

export interface Operacion {
  op: string;
  args: Record<string, unknown>;
  uid: string;
  exp: number;
  resumen: string;
}

export function empaquetar(o: Operacion): string {
  return Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
}

export function desempaquetar(id: string, uid: string): Operacion {
  let o: Operacion;
  try {
    o = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as Operacion;
  } catch {
    throw new AccesoError('Ese identificador de confirmación no es válido.');
  }
  if (o.uid !== uid) {
    throw new AccesoError('Esa operación la preparó otra cuenta. Prepárala de nuevo.');
  }
  if (Date.now() > o.exp) {
    throw new AccesoError('El borrador caducó (dura 15 minutos). Prepáralo de nuevo.');
  }
  return o;
}

function borrador(uid: string, op: string, args: Record<string, unknown>, resumen: string) {
  const o: Operacion = { op, args, uid, exp: Date.now() + VIGENCIA_MS, resumen };
  return [
    'BORRADOR — todavía no se ha guardado nada.',
    '',
    resumen,
    '',
    'Si está bien, confírmalo con la herramienta "confirmar_operacion" usando:',
    `confirmacion_id: ${empaquetar(o)}`,
    '',
    'Caduca en 15 minutos.',
  ].join('\n');
}

/** Id al estilo de los que genera Firestore. */
function idNuevo(): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 20; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

/* ------------------------------------------------------------------ */
/* Preparar                                                            */
/* ------------------------------------------------------------------ */

export async function prepararCrearReunion(
  c: Cliente,
  tipo: TipoCorto,
  modalidad: Modality,
  fecha: string,
  coordinadora?: string,
): Promise<string> {
  const d = new Date(`${fecha}T12:00:00`);
  if (isNaN(d.getTime())) throw new AccesoError(`La fecha "${fecha}" no se entiende. Usa AAAA-MM-DD.`);

  const type = TIPOS[tipo];
  const yaHay = (await c.cargarSesiones()).filter(
    (s) => s.type === type && toDate(s.date).toDateString() === d.toDateString(),
  );

  return borrador(
    c.uid,
    'crear_reunion',
    { tipo, modalidad, fecha, coordinadora: coordinadora ?? '' },
    [
      `Crear reunión de ${SESSION_TYPE_LABELS[type]}`,
      `  Fecha: ${fmtDate(d)}`,
      `  Modalidad: ${MODALITY_LABELS[modalidad]}`,
      `  Coordina: ${coordinadora || 'sin asignar'}`,
      `  Queda ABIERTA para tomar asistencia.`,
      ...(yaHay.length
        ? ['', `⚠️ OJO: ya existe ${yaHay.length} reunión de ese tipo ese mismo día.`]
        : []),
    ].join('\n'),
  );
}

export async function prepararMarcar(
  c: Cliente,
  reunionId: string,
  personaId: string,
  quitar: boolean,
): Promise<string> {
  const sesion = (await c.cargarSesiones()).find((s) => s.id === reunionId);
  if (!sesion) throw new AccesoError(`No existe ninguna reunión con id ${reunionId}.`);
  const persona = (await c.cargarPersonas()).find((p) => p.id === personaId);
  if (!persona) throw new AccesoError(`No existe ninguna persona con id ${personaId}.`);

  const yaEsta = (await c.cargarAsistencia()).some(
    (a) => a.sessionId === reunionId && a.memberId === personaId,
  );

  if (quitar && !yaEsta) throw new AccesoError(`${persona.fullName} no figura en esa reunión.`);
  if (!quitar && yaEsta) throw new AccesoError(`${persona.fullName} ya figura como presente.`);

  return borrador(
    c.uid,
    quitar ? 'quitar_presente' : 'marcar_presente',
    { reunionId, personaId },
    [
      quitar ? 'QUITAR de la lista de asistencia:' : 'MARCAR como presente:',
      `  ${persona.fullName}`,
      `  en ${SESSION_TYPE_LABELS[sesion.type]} del ${fmtDate(sesion.date)}` +
        ` (${MODALITY_LABELS[sesion.modality]})`,
      ...(sesion.status === 'closed'
        ? ['', 'Esa reunión está CERRADA; se corrige igual por ser administración.']
        : []),
    ].join('\n'),
  );
}

export async function prepararEstadoReunion(
  c: Cliente,
  reunionId: string,
  cerrar: boolean,
): Promise<string> {
  const sesion = (await c.cargarSesiones()).find((s) => s.id === reunionId);
  if (!sesion) throw new AccesoError(`No existe ninguna reunión con id ${reunionId}.`);
  if (cerrar && sesion.status === 'closed') throw new AccesoError('Esa reunión ya está cerrada.');
  if (!cerrar && sesion.status === 'open') throw new AccesoError('Esa reunión ya está abierta.');

  return borrador(
    c.uid,
    cerrar ? 'cerrar_reunion' : 'reabrir_reunion',
    { reunionId },
    [
      cerrar ? 'CERRAR la reunión:' : 'REABRIR la reunión:',
      `  ${SESSION_TYPE_LABELS[sesion.type]} del ${fmtDate(sesion.date)}`,
      cerrar
        ? '  Al cerrarla, las coordinadoras ya no podrán modificarla.'
        : '  Al reabrirla, las coordinadoras vuelven a poder marcar asistencia.',
    ].join('\n'),
  );
}

export async function prepararAprobarPersona(
  c: Cliente,
  personaId: string,
  nombreCorregido?: string,
): Promise<string> {
  const persona = (await c.cargarPersonas()).find((p) => p.id === personaId);
  if (!persona) throw new AccesoError(`No existe ninguna persona con id ${personaId}.`);
  if (!persona.pendingReview) {
    throw new AccesoError(`${persona.fullName} ya forma parte de la lista oficial.`);
  }
  const nombre = (nombreCorregido ?? persona.fullName).trim();
  if (nombre.length < 3) throw new AccesoError('El nombre es demasiado corto.');

  return borrador(
    c.uid,
    'aprobar_persona',
    { personaId, nombre },
    [
      'APROBAR e incorporar a la lista oficial:',
      `  ${nombre}` + (nombre !== persona.fullName ? `   (antes: "${persona.fullName}")` : ''),
      persona.createdByName ? `  La registró: ${persona.createdByName}` : '',
      '',
      'Nota: esto solo aprueba la ficha. Si el nombre cambia, la asistencia ya',
      'registrada conserva el nombre anterior; para corregir todo el historial',
      'usa la pantalla "Revisar" de la app.',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

/* ------------------------------------------------------------------ */
/* Ejecutar                                                            */
/* ------------------------------------------------------------------ */

export async function ejecutar(c: Cliente, o: Operacion): Promise<string> {
  switch (o.op) {
    case 'crear_reunion': {
      const { tipo, modalidad, fecha, coordinadora } = o.args as {
        tipo: TipoCorto;
        modalidad: Modality;
        fecha: string;
        coordinadora: string;
      };
      const id = idNuevo();
      const type: SessionType = TIPOS[tipo];
      await c.escribir(`sessions/${id}`, {
        type,
        modality: modalidad,
        date: new Date(`${fecha}T12:00:00`),
        status: 'open',
        createdBy: c.uid,
        createdByName: c.nombre,
        createdAt: new Date(),
        presentCount: 0,
        coordinator: coordinadora ?? '',
      });
      return `Listo. Reunión de ${SESSION_TYPE_LABELS[type]} creada para el ${fmtDate(
        new Date(`${fecha}T12:00:00`),
      )} y abierta para tomar asistencia.\n  id: ${id}`;
    }

    case 'marcar_presente':
    case 'quitar_presente': {
      const { reunionId, personaId } = o.args as { reunionId: string; personaId: string };
      const sesion = (await c.cargarSesiones()).find((s) => s.id === reunionId);
      if (!sesion) throw new AccesoError('La reunión ya no existe.');
      const persona = (await c.cargarPersonas()).find((p) => p.id === personaId);
      if (!persona) throw new AccesoError('La persona ya no existe.');

      if (o.op === 'marcar_presente') {
        await c.escribir(`sessions/${reunionId}/attendance/${personaId}`, {
          memberId: personaId,
          fullName: persona.fullName,
          status: 'present',
          checkedInAt: new Date(),
          checkedInBy: c.uid,
          checkedInByName: c.nombre,
          sessionId: reunionId,
          sessionType: sesion.type,
          modality: sesion.modality,
          sessionDate: toDate(sesion.date),
        });
      } else {
        await c.borrar(`sessions/${reunionId}/attendance/${personaId}`);
      }

      // El contador de presentes se recalcula con lo que hay, no se estima.
      const presentes = (await c.cargarAsistencia()).filter(
        (a) => a.sessionId === reunionId,
      ).length;
      await c.escribir(`sessions/${reunionId}`, { presentCount: presentes }, ['presentCount']);

      return (
        `Listo. ${persona.fullName} ${o.op === 'marcar_presente' ? 'quedó presente en' : 'salió de'}` +
        ` ${SESSION_TYPE_LABELS[sesion.type]} del ${fmtDate(sesion.date)}.` +
        ` Ahora hay ${presentes} presentes.`
      );
    }

    case 'cerrar_reunion':
    case 'reabrir_reunion': {
      const { reunionId } = o.args as { reunionId: string };
      const estado = o.op === 'cerrar_reunion' ? 'closed' : 'open';
      await c.escribir(`sessions/${reunionId}`, { status: estado }, ['status']);
      return `Listo. La reunión quedó ${estado === 'closed' ? 'cerrada' : 'abierta'}.`;
    }

    case 'aprobar_persona': {
      const { personaId, nombre } = o.args as { personaId: string; nombre: string };
      await c.escribir(
        `members/${personaId}`,
        { fullName: nombre, searchName: normalizeText(nombre), pendingReview: false },
        ['fullName', 'searchName', 'pendingReview'],
      );
      return `Listo. ${nombre} ya forma parte de la lista oficial.`;
    }

    default:
      throw new AccesoError(`Operación desconocida: ${o.op}`);
  }
}
