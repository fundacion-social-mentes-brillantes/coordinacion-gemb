import { createHash } from 'node:crypto';
import type { Cliente, Escritura } from './rest';
import { AccesoError, ConflictoError, olvidar } from './rest';
import { buildNameParts, normalizeText } from '../../src/lib/normalize';
import {
  SESSION_TYPE_LABELS,
  MODALITY_LABELS,
  MODALITIES,
  UNKNOWN_PREFIX,
} from '../../src/lib/constants';
import {
  dayKey,
  daysFromToday,
  fmtDate,
  isValidDateKey,
  sessionDateFromKey,
  toDate,
} from '../../src/lib/dates';
import { findSimilarMembers } from '../../src/lib/search';
import { sessionIdDelDia, walkinId } from '../../src/lib/ids';
import { TIPOS, type TipoCorto } from './informes';
import type { Member, Modality, Session, SessionType } from '../../src/types';

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
//
//  Confirmar dos veces el mismo borrador (un reintento tras un error de red)
//  no repite nada: los ids se deciden al preparar, y cada creación exige que
//  el documento NO exista todavía. Marcar, quitar y sumar al contador van en
//  un solo lote atómico, como en la app.
// ---------------------------------------------------------------------------

const VIGENCIA_MS = 15 * 60_000;

export interface Operacion {
  op: string;
  args: Record<string, unknown>;
  uid: string;
  exp: number;
}

/** Huella del contenido: si Claude copia mal un carácter, no se ejecuta otra cosa. */
const huella = (json: string) =>
  createHash('sha256').update(json).digest('base64url').slice(0, 16);

export function empaquetar(o: Operacion): string {
  const json = JSON.stringify(o);
  return `${Buffer.from(json, 'utf8').toString('base64url')}.${huella(json)}`;
}

export function desempaquetar(id: string, uid: string): Operacion {
  const [cuerpo, firma] = id.trim().split('.');
  let json = '';
  let o: Operacion;
  try {
    json = Buffer.from(cuerpo ?? '', 'base64url').toString('utf8');
    o = JSON.parse(json) as Operacion;
  } catch {
    throw new AccesoError('Ese identificador de confirmación no es válido. Prepara la operación de nuevo.');
  }
  if (!firma || firma !== huella(json)) {
    throw new AccesoError(
      'Ese identificador de confirmación llegó alterado (¿se copió incompleto?). ' +
        'No se ejecutó nada: prepara la operación de nuevo.',
    );
  }
  if (o.uid !== uid) {
    throw new AccesoError('Esa operación la preparó otra cuenta. Prepárala de nuevo.');
  }
  if (typeof o.exp !== 'number' || Date.now() > o.exp) {
    throw new AccesoError('El borrador caducó (dura 15 minutos). Prepáralo de nuevo.');
  }
  return o;
}

function borrador(uid: string, op: string, args: Record<string, unknown>, resumen: string) {
  const o: Operacion = { op, args, uid, exp: Date.now() + VIGENCIA_MS };
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
/* Validación de lo que llega                                          */
/* ------------------------------------------------------------------ */

const ID_VALIDO = /^[A-Za-z0-9_-]{1,80}$/;

function idDe(v: unknown, que: string): string {
  const s = String(v ?? '').trim();
  if (!ID_VALIDO.test(s)) throw new AccesoError(`El id de ${que} ("${s}") no es válido.`);
  return s;
}

function tipoDe(v: unknown): TipoCorto {
  if (v === 'pasos' || v === 'ego') return v;
  throw new AccesoError('El tipo tiene que ser "pasos" o "ego".');
}

function modalidadDe(v: unknown): Modality {
  if ((MODALITIES as string[]).includes(String(v))) return v as Modality;
  throw new AccesoError('La modalidad tiene que ser "presencial" o "virtual".');
}

function fechaDe(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!isValidDateKey(s)) throw new AccesoError(`La fecha "${s}" no se entiende. Usa AAAA-MM-DD.`);
  return s;
}

/* ------------------------------------------------------------------ */
/* Lecturas puntuales (siempre recién leídas)                          */
/* ------------------------------------------------------------------ */

async function reunion(c: Cliente, id: string): Promise<Session> {
  const s = await c.leer<Session>(`sessions/${id}`);
  if (!s) {
    throw new AccesoError(
      `No existe ninguna reunión con id ${id}. Búscala con la herramienta "reuniones".`,
    );
  }
  return s;
}

async function persona(c: Cliente, id: string): Promise<Member> {
  const p = await c.leer<Member>(`members/${id}`);
  if (!p) {
    throw new AccesoError(
      `No existe ninguna persona con id ${id} (quizá la unieron con otra ficha). ` +
        'Búscala de nuevo con "buscar_persona".',
    );
  }
  return p;
}

const describir = (s: Session) =>
  `${SESSION_TYPE_LABELS[s.type]} del ${fmtDate(s.date)} (${MODALITY_LABELS[s.modality]})`;

/** No se marca a nadie en una reunión que todavía no ocurre (igual que en la app). */
function exigirQueYaOcurrio(s: Session) {
  if (daysFromToday(s.date) > 0) {
    throw new AccesoError(
      `Esa reunión es del ${fmtDate(s.date)}: todavía no ha ocurrido, así que no se ` +
        'puede tomar lista en ella. Revisa el id con la herramienta "reuniones".',
    );
  }
}

/** Una reunión que ya pasó y sigue abierta: cualquiera podría seguir tocándola. */
function avisoSiSigueAbierta(s: Session): string[] {
  return s.status === 'open' && daysFromToday(s.date) < 0
    ? [
        '',
        'Esta reunión sigue ABIERTA aunque ya pasó. Cuando termines de pasar la ' +
          'lista, ciérrala con "preparar_cerrar_reunion".',
      ]
    : [];
}

async function presentesEn(c: Cliente, reunionId: string) {
  return (await c.asistenciaDe(reunionId)).length;
}

function asistenciaNueva(c: Cliente, s: Session, memberId: string, fullName: string) {
  return {
    memberId,
    fullName,
    status: 'present',
    checkedInAt: new Date(),
    checkedInBy: c.uid,
    checkedInByName: c.nombre,
    sessionId: s.id,
    sessionType: s.type,
    modality: s.modality,
    sessionDate: toDate(s.date),
  };
}

/* ------------------------------------------------------------------ */
/* Preparar                                                            */
/* ------------------------------------------------------------------ */

export async function prepararCrearReunion(
  c: Cliente,
  tipoRaw: unknown,
  modalidadRaw: unknown,
  fechaRaw: unknown,
  coordinadora?: string,
  otraMas = false,
): Promise<string> {
  const tipo = tipoDe(tipoRaw);
  const modalidad = modalidadDe(modalidadRaw);
  const fecha = fechaDe(fechaRaw);
  const type = TIPOS[tipo];
  const d = sessionDateFromKey(fecha);

  // Datos frescos: justo esto es lo que no puede salir de una caché vieja.
  olvidar(c.uid);
  const yaHay = (await c.cargarSesiones()).filter(
    (s) => s.type === type && dayKey(s.date) === fecha,
  );
  if (yaHay.length && !otraMas) {
    throw new AccesoError(
      [
        `Ya existe una reunión de ${SESSION_TYPE_LABELS[type]} el ${fmtDate(d)}:`,
        ...yaHay.map((s) => `  id: ${s.id}${s.status === 'open' ? ' (abierta)' : ' (cerrada)'}`),
        'Usa esa; no hace falta crear otra. Si de verdad es OTRA reunión el mismo ' +
          'día, prepara de nuevo con otra_mas=true.',
      ].join('\n'),
    );
  }
  // La primera del día tiene el mismo id que le daría la app: si una
  // coordinadora la crea a la vez desde su celular, es la misma reunión.
  const id = yaHay.length ? idNuevo() : sessionIdDelDia(type, fecha);
  const dias = daysFromToday(d);

  return borrador(
    c.uid,
    'crear_reunion',
    { id, tipo, modalidad, fecha, coordinadora: (coordinadora ?? '').trim() },
    [
      `Crear reunión de ${SESSION_TYPE_LABELS[type]}`,
      `  Fecha: ${fmtDate(d)}`,
      `  Modalidad: ${MODALITY_LABELS[modalidad]}`,
      `  Coordina: ${coordinadora?.trim() || 'sin asignar'}`,
      `  Queda ABIERTA para tomar asistencia.`,
      ...(yaHay.length ? ['', `⚠️ Será la reunión número ${yaHay.length + 1} de ese tipo ese día.`] : []),
      ...(dias < 0
        ? [
            '',
            'Es de un día que ya pasó: después de pasar la lista, ciérrala con ' +
              '"preparar_cerrar_reunion" para que nadie la siga modificando.',
          ]
        : []),
      ...(dias > 0
        ? ['', 'Queda AGENDADA: no se podrá tomar lista en ella hasta ese día.']
        : []),
    ].join('\n'),
  );
}

export async function prepararMarcar(
  c: Cliente,
  reunionRaw: unknown,
  personaRaw: unknown,
  quitar: boolean,
): Promise<string> {
  const reunionId = idDe(reunionRaw, 'la reunión');
  const personaId = idDe(personaRaw, 'la persona');
  const [sesion, ficha, registro] = await Promise.all([
    reunion(c, reunionId),
    persona(c, personaId),
    c.leer(`sessions/${reunionId}/attendance/${personaId}`),
  ]);
  if (!quitar) exigirQueYaOcurrio(sesion);

  if (quitar && !registro) throw new AccesoError(`${ficha.fullName} no figura en esa reunión.`);
  if (!quitar && registro) throw new AccesoError(`${ficha.fullName} ya figura como presente.`);

  return borrador(
    c.uid,
    quitar ? 'quitar_presente' : 'marcar_presente',
    { reunionId, personaId },
    [
      quitar ? 'QUITAR de la lista de asistencia:' : 'MARCAR como presente:',
      `  ${ficha.fullName}` +
        (ficha.pendingReview ? ' (por revisar)' : '') +
        (ficha.active === false ? ' (ficha inactiva)' : ''),
      `  en ${describir(sesion)}`,
      ...(sesion.status === 'closed'
        ? ['', 'Esa reunión está CERRADA; se corrige igual por ser administración.']
        : []),
    ].join('\n'),
  );
}

/**
 * Alguien asistió pero no tiene ficha. Igual que cuando una coordinadora lo
 * agrega en plena reunión desde la app: se crea una ficha "por revisar" (fuera
 * de la lista oficial) y se marca presente, para que la lista de la reunión
 * quede completa.
 *
 * Antes de crear nada busca fichas parecidas (nombre, alias y errores de una
 * letra, con la misma función que usa la app): la auditoría de septiembre de
 * 2026 encontró a varias personas partidas en dos y tres fichas justamente
 * por crear una nueva cuando ya existía.
 */
export async function prepararAgregarParticipante(
  c: Cliente,
  reunionRaw: unknown,
  nombreRaw: unknown,
): Promise<string> {
  const reunionId = idDe(reunionRaw, 'la reunión');
  const parts = buildNameParts(String(nombreRaw ?? ''));
  if (parts.fullName.length < 3) throw new AccesoError('El nombre es demasiado corto.');
  if (parts.fullName.startsWith(UNKNOWN_PREFIX)) {
    throw new AccesoError('Hace falta el nombre de la persona (aunque sea solo el primer nombre).');
  }

  const sesion = await reunion(c, reunionId);
  exigirQueYaOcurrio(sesion);

  const [asistentes, personas] = await Promise.all([c.asistenciaDe(reunionId), c.cargarPersonas()]);
  const yaEnLaReunion = asistentes.find((a) => normalizeText(a.fullName) === parts.searchName);
  if (yaEnLaReunion) throw new AccesoError(`${yaEnLaReunion.fullName} ya figura en esa reunión.`);

  const id = walkinId(reunionId, parts.searchName);
  if (await c.leer(`members/${id}`)) {
    throw new AccesoError(`${parts.fullName} ya se había agregado a esa reunión (id: ${id}).`);
  }

  const parecidas = findSimilarMembers(personas, parts.fullName, 8);

  return borrador(
    c.uid,
    'agregar_participante',
    { reunionId, nombre: parts.fullName, id },
    [
      'AGREGAR como participante (queda "por revisar", NO entra a la lista oficial):',
      `  ${parts.fullName}`,
      `  y marcarla presente en ${describir(sesion)}`,
      ...(parecidas.length
        ? [
            '',
            '⚠️ OJO: ya hay fichas con un nombre parecido. Si es alguna de ellas, no',
            'la agregues de nuevo: márcala con "preparar_marcar_presente".',
            ...parecidas.map(
              ({ member: p, exact }) =>
                `  · ${p.fullName}${exact ? ' (MISMO nombre)' : ''}` +
                `${p.pendingReview ? ' (por revisar)' : ''}` +
                `${p.active === false ? ' (inactiva)' : ''}  id: ${p.id}`,
            ),
          ]
        : []),
      ...(sesion.status === 'closed'
        ? ['', 'Esa reunión está CERRADA; se corrige igual por ser administración.']
        : []),
    ].join('\n'),
  );
}

export async function prepararEstadoReunion(
  c: Cliente,
  reunionRaw: unknown,
  cerrar: boolean,
): Promise<string> {
  const reunionId = idDe(reunionRaw, 'la reunión');
  const sesion = await reunion(c, reunionId);
  if (cerrar && sesion.status === 'closed') throw new AccesoError('Esa reunión ya está cerrada.');
  if (!cerrar && sesion.status === 'open') throw new AccesoError('Esa reunión ya está abierta.');

  return borrador(
    c.uid,
    cerrar ? 'cerrar_reunion' : 'reabrir_reunion',
    { reunionId },
    [
      cerrar ? 'CERRAR la reunión:' : 'REABRIR la reunión:',
      `  ${describir(sesion)}`,
      cerrar
        ? '  Al cerrarla, las coordinadoras ya no podrán modificarla.'
        : '  Al reabrirla, las coordinadoras vuelven a poder marcar asistencia.',
    ].join('\n'),
  );
}

export async function prepararAprobarPersona(
  c: Cliente,
  personaRaw: unknown,
  nombreCorregido?: string,
): Promise<string> {
  const personaId = idDe(personaRaw, 'la persona');
  const ficha = await persona(c, personaId);
  if (!ficha.pendingReview) {
    throw new AccesoError(
      `${ficha.fullName} ya forma parte de la lista oficial.` +
        (ficha.pendingIdentify
          ? ' Sigue sin nombre real: corrígelo en la app (Personas → Editar).'
          : ''),
    );
  }
  const parts = buildNameParts((nombreCorregido ?? ficha.fullName).trim());
  if (parts.fullName.length < 3) throw new AccesoError('El nombre es demasiado corto.');
  if (parts.fullName.startsWith(UNKNOWN_PREFIX)) {
    throw new AccesoError(
      `"${parts.fullName}" no es un nombre real. Para aprobarla, pásale su nombre en "nombre".`,
    );
  }

  const [registros, personas] = await Promise.all([
    c.asistenciasDePersona(personaId),
    c.cargarPersonas(),
  ]);
  const parecidas = findSimilarMembers(
    personas.filter((p) => p.id !== personaId && !p.pendingReview),
    parts.fullName,
    6,
  );
  const aCorregir = registros.filter((r) => r.datos.fullName !== parts.fullName).length;

  return borrador(
    c.uid,
    'aprobar_persona',
    { personaId, nombre: parts.fullName },
    [
      'APROBAR e incorporar a la lista oficial:',
      `  ${parts.fullName}` +
        (parts.fullName !== ficha.fullName ? `   (antes: "${ficha.fullName}")` : ''),
      ...(ficha.createdByName ? [`  La registró: ${ficha.createdByName}`] : []),
      ...(aCorregir
        ? [`  Se corrige el nombre en ${aCorregir} asistencia(s) ya registradas.`]
        : []),
      ...(parecidas.length
        ? [
            '',
            '⚠️ OJO: en la lista oficial ya hay fichas parecidas. Si es la misma',
            'persona, NO la apruebes: únelas desde la app (Revisar → "Es la misma',
            'persona"), así su asistencia queda en una sola ficha.',
            ...parecidas.map(({ member: p }) => `  · ${p.fullName}  id: ${p.id}`),
          ]
        : []),
    ].join('\n'),
  );
}

/* ------------------------------------------------------------------ */
/* Ejecutar                                                            */
/* ------------------------------------------------------------------ */

export async function ejecutar(c: Cliente, o: Operacion): Promise<string> {
  switch (o.op) {
    case 'crear_reunion': {
      const id = idDe(o.args.id, 'la reunión');
      const type: SessionType = TIPOS[tipoDe(o.args.tipo)];
      const modalidad = modalidadDe(o.args.modalidad);
      const fecha = fechaDe(o.args.fecha);
      const coordinadora = String(o.args.coordinadora ?? '').trim();
      const d = sessionDateFromKey(fecha);
      try {
        await c.guardar([
          {
            tipo: 'crear',
            ruta: `sessions/${id}`,
            datos: {
              type,
              modality: modalidad,
              date: d,
              status: 'open',
              createdBy: c.uid,
              createdByName: c.nombre,
              createdAt: new Date(),
              presentCount: 0,
              coordinator: coordinadora,
            },
          },
        ]);
      } catch (e) {
        if (e instanceof ConflictoError && e.motivo === 'ya_existe') {
          return (
            `Esa reunión ya estaba creada (id: ${id}); no se creó otra. ` +
            'Si confirmaste dos veces, la primera ya había quedado guardada.'
          );
        }
        throw e;
      }
      return (
        `Listo. Reunión de ${SESSION_TYPE_LABELS[type]} creada para el ${fmtDate(d)}` +
        ` y abierta para tomar asistencia.\n  id: ${id}` +
        (daysFromToday(d) < 0
          ? '\n\nCuando termines de pasar la lista, ciérrala con "preparar_cerrar_reunion".'
          : '')
      );
    }

    case 'marcar_presente':
    case 'quitar_presente': {
      const reunionId = idDe(o.args.reunionId, 'la reunión');
      const personaId = idDe(o.args.personaId, 'la persona');
      const marcar = o.op === 'marcar_presente';
      const [sesion, ficha] = await Promise.all([reunion(c, reunionId), persona(c, personaId)]);
      if (marcar) exigirQueYaOcurrio(sesion);

      const ruta = `sessions/${reunionId}/attendance/${personaId}`;
      const lote: Escritura[] = marcar
        ? [{ tipo: 'crear', ruta, datos: asistenciaNueva(c, sesion, personaId, ficha.fullName) }]
        : [{ tipo: 'borrar', ruta }];
      // El contador sube o baja en el MISMO lote y con suma atómica: no pisa
      // lo que estén marcando a la vez las coordinadoras desde la app.
      lote.push({
        tipo: 'sumar',
        ruta: `sessions/${reunionId}`,
        campo: 'presentCount',
        cantidad: marcar ? 1 : -1,
      });

      const yaHecho = async () => {
        const presentes = await presentesEn(c, reunionId);
        return marcar
          ? `${ficha.fullName} ya figuraba como presente: no se contó dos veces. Hay ${presentes} presentes.`
          : `${ficha.fullName} ya no figuraba en esa reunión: no se restó nada. Hay ${presentes} presentes.`;
      };
      try {
        await c.guardar(lote);
      } catch (e) {
        // Repetir la operación (confirmar dos veces) choca con el estado
        // actual. Según el caso, Firestore lo dice como "ya existe"/"no
        // existe" o, porque las reglas se evalúan antes, como permiso
        // denegado: se relee para saber si de verdad ya estaba hecho.
        const choque =
          e instanceof ConflictoError ||
          (e instanceof AccesoError && e.message === 'PERMISSION_DENIED');
        if (choque) {
          const esta = (await c.leer(ruta)) !== null;
          if (esta === marcar) return yaHecho();
        }
        throw e;
      }

      const presentes = await presentesEn(c, reunionId);
      return [
        `Listo. ${ficha.fullName} ${marcar ? 'quedó presente en' : 'salió de'} ${describir(sesion)}.` +
          ` Ahora hay ${presentes} presentes.`,
        ...avisoSiSigueAbierta(sesion),
      ].join('\n');
    }

    case 'agregar_participante': {
      const reunionId = idDe(o.args.reunionId, 'la reunión');
      const id = idDe(o.args.id, 'la ficha');
      const parts = buildNameParts(String(o.args.nombre ?? ''));
      const sesion = await reunion(c, reunionId);
      exigirQueYaOcurrio(sesion);
      const fechaReunion = toDate(sesion.date);

      // Los mismos campos que escribe la app (addWalkinAndMarkPresent), y en
      // un solo lote: o queda todo (ficha + asistencia + contador) o nada.
      try {
        await c.guardar([
          {
            tipo: 'crear',
            ruta: `members/${id}`,
            datos: {
              fullName: parts.fullName,
              firstName: parts.firstName,
              lastName: parts.lastName,
              searchName: parts.searchName,
              aliases: [],
              phone: '',
              notes: '',
              active: true,
              createdAt: new Date(),
              createdBy: c.uid,
              createdByName: c.nombre,
              pendingIdentify: false,
              pendingReview: true,
              sourceSessionId: reunionId,
              sourceSessionDate: fechaReunion,
            },
          },
          {
            tipo: 'crear',
            ruta: `sessions/${reunionId}/attendance/${id}`,
            datos: asistenciaNueva(c, sesion, id, parts.fullName),
          },
          { tipo: 'sumar', ruta: `sessions/${reunionId}`, campo: 'presentCount', cantidad: 1 },
        ]);
      } catch (e) {
        if (e instanceof ConflictoError && e.motivo === 'ya_existe') {
          return (
            `${parts.fullName} ya se había agregado a esa reunión (id: ${id}); no se ` +
            'creó otra ficha. Si confirmaste dos veces, la primera ya había quedado guardada.'
          );
        }
        throw e;
      }

      const presentes = await presentesEn(c, reunionId);
      return [
        `Listo. ${parts.fullName} quedó presente en ${describir(sesion)} y espera` +
          ` revisión (no está en la lista oficial). Ahora hay ${presentes} presentes.` +
          `\n  id: ${id}`,
        ...avisoSiSigueAbierta(sesion),
      ].join('\n');
    }

    case 'cerrar_reunion':
    case 'reabrir_reunion': {
      const reunionId = idDe(o.args.reunionId, 'la reunión');
      const estado = o.op === 'cerrar_reunion' ? 'closed' : 'open';
      try {
        await c.guardar([{ tipo: 'actualizar', ruta: `sessions/${reunionId}`, datos: { status: estado } }]);
      } catch (e) {
        // Sobre un documento borrado, las reglas responden "permiso denegado"
        // antes que "no existe": se relee para dar el motivo real.
        if (
          (e instanceof ConflictoError || (e instanceof AccesoError && e.message === 'PERMISSION_DENIED')) &&
          !(await c.leer(`sessions/${reunionId}`))
        ) {
          throw new AccesoError('Esa reunión ya no existe (la borraron). No se cambió nada.');
        }
        throw e;
      }
      return `Listo. La reunión quedó ${estado === 'closed' ? 'cerrada' : 'abierta'}.`;
    }

    case 'aprobar_persona': {
      const personaId = idDe(o.args.personaId, 'la persona');
      const parts = buildNameParts(String(o.args.nombre ?? ''));
      if (parts.fullName.length < 3 || parts.fullName.startsWith(UNKNOWN_PREFIX)) {
        throw new AccesoError('El nombre no es válido. Prepara la aprobación de nuevo.');
      }
      const ficha = await c.leer<Member>(`members/${personaId}`);
      if (!ficha) {
        throw new AccesoError(
          'Esa ficha ya no existe (la unieron con otra o la descartaron). No se cambió nada.',
        );
      }
      if (!ficha.pendingReview) return `${ficha.fullName} ya estaba aprobada.`;

      // Como la app (approveMember): primero el nombre en sus asistencias y
      // DESPUÉS la aprobación. Si lo primero falla, sigue "por revisar" y se
      // puede reintentar, en vez de quedar aprobada con el nombre viejo.
      const registros = (await c.asistenciasDePersona(personaId)).filter(
        (r) => r.datos.fullName !== parts.fullName,
      );
      const correcciones: Escritura[] = registros.map((r) => ({
        tipo: 'actualizar',
        ruta: r.ruta,
        datos: { fullName: parts.fullName },
      }));
      const aprobacion: Escritura = {
        tipo: 'actualizar',
        ruta: `members/${personaId}`,
        datos: {
          fullName: parts.fullName,
          firstName: parts.firstName,
          lastName: parts.lastName,
          searchName: parts.searchName,
          pendingReview: false,
          pendingIdentify: false,
        },
      };
      try {
        if (correcciones.length < 500) {
          await c.guardar([...correcciones, aprobacion]);
        } else {
          for (let i = 0; i < correcciones.length; i += 450) {
            await c.guardar(correcciones.slice(i, i + 450));
          }
          await c.guardar([aprobacion]);
        }
      } catch (e) {
        // Una administradora puede escribir todo esto: si las reglas lo
        // niegan es porque algún documento desapareció mientras tanto.
        if (
          e instanceof ConflictoError ||
          (e instanceof AccesoError && e.message === 'PERMISSION_DENIED')
        ) {
          throw new AccesoError(
            'La ficha o alguna de sus asistencias cambió mientras tanto. No se guardó ' +
              'nada: prepara la aprobación de nuevo.',
          );
        }
        throw e;
      }
      return (
        `Listo. ${parts.fullName} ya forma parte de la lista oficial.` +
        (registros.length ? ` Se corrigió el nombre en ${registros.length} asistencia(s).` : '')
      );
    }

    default:
      throw new AccesoError(`Operación desconocida: ${o.op}`);
  }
}
