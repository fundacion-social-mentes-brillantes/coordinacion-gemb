import { olvidar, type Cliente } from './rest';
import {
  desempaquetar,
  ejecutar,
  prepararAgregarParticipante,
  prepararAprobarPersona,
  prepararCrearReunion,
  prepararEstadoReunion,
  prepararMarcar,
} from './escrituras';
import type { Session } from '../../src/types';
import {
  informeAsistenciaReunion,
  informeBuscarPersona,
  informeComoVamos,
  informeConteos,
  informeHistorial,
  informePorRevisar,
  informeReuniones,
  type TipoCorto,
} from './informes';

// ---------------------------------------------------------------------------
//  Las herramientas, definidas UNA vez y compartidas por los dos servidores
//  (el de HTTP en Vercel y el de terminal).
//
//  Cada una declara quién puede usarla. La regla sigue a la app: una
//  coordinadora ve las reuniones y cómo va el grupo; el detalle de UNA persona
//  concreta y la bandeja de revisión son asuntos de administración.
//
//  Esto es solo la primera puerta. La segunda, la que de verdad manda, son las
//  reglas de Firestore: aunque alguien se saltara esta lista, seguiría leyendo
//  únicamente lo que su cuenta puede leer.
// ---------------------------------------------------------------------------

/**
 * 'todos'   → leer. Coordinación y administración.
 * 'admin'   → leer cosas de administración.
 * 'escribir'→ MODIFICA datos. Solo administración, y en dos pasos.
 */
export type Alcance = 'todos' | 'admin' | 'escribir';

export interface Herramienta {
  name: string;
  title: string;
  description: string;
  alcance: Alcance;
  inputSchema: Record<string, unknown>;
  ejecutar: (c: Cliente, args: Record<string, unknown>) => Promise<string>;
}

const objeto = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
});
const txt = (description: string) => ({ type: 'string', description });

export const HERRAMIENTAS: Herramienta[] = [
  {
    name: 'quien_soy',
    title: 'Con qué cuenta estoy consultando',
    description:
      'Dice con qué cuenta y con qué rol está conectado Claude, y por tanto qué ' +
      'puede y qué no puede consultar. Útil para comprobar que la llave es la ' +
      'correcta.',
    alcance: 'todos',
    inputSchema: objeto(),
    async ejecutar(c) {
      const permitidas = HERRAMIENTAS.filter((h) => permitida(h, c));
      const escritura = permitidas.filter((h) => h.alcance === 'escribir');
      return [
        `Cuenta: ${c.nombre} (${c.email})`,
        `Rol: ${ROL_LEGIBLE[c.rol] ?? c.rol}`,
        '',
        c.esAdmin
          ? 'PERMISOS: LECTURA Y ESCRITURA. Puedes consultar todo y además ' +
            'registrar y corregir cosas (siempre con una confirmación de por medio).'
          : 'PERMISOS: SOLO LECTURA. Puedes consultar, pero NO se puede cambiar ' +
            'nada desde aquí: ni marcar asistencia, ni crear reuniones, ni tocar ' +
            'fichas. Eso es de administración.',
        '',
        `Herramientas disponibles para ti: ${permitidas.length} de ${HERRAMIENTAS.length}`,
        ...permitidas
          .filter((h) => h.alcance !== 'escribir')
          .map((h) => `  · ${h.name} (consulta)`),
        ...escritura.map((h) => `  · ${h.name} (MODIFICA datos)`),
        ...(c.esAdmin
          ? []
          : [
              '',
              'Tampoco ves el historial de una persona concreta ni la bandeja de ' +
                'revisión: eso también es de administración.',
            ]),
      ].join('\n');
    },
  },
  {
    name: 'como_vamos',
    title: '¿Cómo vamos?',
    description:
      'Responde cuántas personas están viniendo ÚLTIMAMENTE a un tipo de reunión ' +
      '(no en todo el año): la cifra, si subió o bajó frente al período anterior, ' +
      'el promedio de presentes por reunión y el reparto en grupos (firmes, nuevas, ' +
      'van y vienen, se están alejando) con los nombres. Es el mismo cálculo que ' +
      'muestra el apartado "¿Cómo vamos?" del Panel de la app.',
    alcance: 'todos',
    inputSchema: objeto({
      tipo: {
        type: 'string',
        enum: ['pasos', 'ego'],
        default: 'pasos',
        description: 'pasos = Entrega de Pasos; ego = Sala de Reducción del Ego',
      },
      ventana: {
        type: 'integer',
        minimum: 1,
        maximum: 52,
        default: 4,
        description: 'Cuántas reuniones hacia atrás mirar. La app usa 4, 8 o 12.',
      },
      con_nombres: { type: 'boolean', default: true, description: 'Incluir los nombres.' },
    }),
    async ejecutar(c, a) {
      const [sessions, attendance] = await Promise.all([
        c.cargarSesiones(),
        c.cargarAsistencia(),
      ]);
      return informeComoVamos(
        sessions,
        attendance,
        (a.tipo as TipoCorto) ?? 'pasos',
        Number(a.ventana ?? 4),
        a.con_nombres !== false,
      );
    },
  },
  {
    name: 'reuniones',
    title: 'Listar reuniones',
    description:
      'Las reuniones más recientes que ya ocurrieron (y aparte las agendadas), con ' +
      'fecha, tipo, modalidad, quién coordinó, cuántas personas asistieron y si la ' +
      'sesión sigue abierta. Devuelve el id de cada una para consultar su lista. ' +
      'Para pasar la lista de una reunión, toma el id de "Recientes", no de "Agendadas".',
    alcance: 'todos',
    inputSchema: objeto({
      tipo: { type: 'string', enum: ['pasos', 'ego', 'todas'], default: 'todas' },
      limite: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
    }),
    async ejecutar(c, a) {
      const [sessions, attendance] = await Promise.all([
        c.cargarSesiones(),
        c.cargarAsistencia(),
      ]);
      return informeReuniones(
        sessions,
        attendance,
        (a.tipo as TipoCorto | 'todas') ?? 'todas',
        Number(a.limite ?? 10),
      );
    },
  },
  {
    name: 'asistencia_reunion',
    title: 'Quiénes fueron a una reunión',
    description:
      'La lista de personas presentes en una reunión concreta. El id se obtiene ' +
      'con la herramienta "reuniones".',
    alcance: 'todos',
    inputSchema: objeto({ reunion_id: txt('id de la reunión') }, ['reunion_id']),
    async ejecutar(c, a) {
      // Solo esa reunión: antes se descargaba toda la asistencia de la historia.
      const id = String(a.reunion_id ?? '').trim();
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return `El id de reunión "${id}" no es válido.`;
      const [sesion, asistentes] = await Promise.all([
        c.leer<Session>(`sessions/${id}`),
        c.asistenciaDe(id),
      ]);
      return informeAsistenciaReunion(sesion, asistentes, id);
    },
  },
  {
    name: 'conteos',
    title: 'Conteos generales',
    description:
      'Totales rápidos: personas en la lista oficial (activas y totales), reuniones ' +
      'registradas por tipo, y cuántas personas nuevas esperan revisión.',
    alcance: 'admin',
    inputSchema: objeto(),
    async ejecutar(c) {
      const [sessions, personas] = await Promise.all([c.cargarSesiones(), c.cargarPersonas()]);
      return informeConteos(sessions, personas);
    },
  },
  {
    name: 'buscar_persona',
    title: 'Buscar una persona',
    description:
      'Busca personas por nombre o alias, igual que el buscador de la app (tolera ' +
      'acentos, mayúsculas, orden de las palabras y errores de tipeo). Devuelve su ' +
      'id para consultar el historial o marcarla presente. No devuelve teléfonos ' +
      'ni notas. Si no aparece con el nombre completo, prueba con solo el primer ' +
      'nombre antes de agregarla como nueva.',
    alcance: 'admin',
    inputSchema: objeto({ nombre: txt('Nombre o parte del nombre') }, ['nombre']),
    async ejecutar(c, a) {
      return informeBuscarPersona(await c.cargarPersonas(), String(a.nombre));
    },
  },
  {
    name: 'historial_persona',
    title: 'Historial de una persona',
    description:
      'Todas las veces que una persona ha asistido, separadas por tipo de reunión, ' +
      'con su porcentaje de asistencia desde que llegó. El id se obtiene con ' +
      '"buscar_persona".',
    alcance: 'admin',
    inputSchema: objeto({ persona_id: txt('id de la persona') }, ['persona_id']),
    async ejecutar(c, a) {
      const id = String(a.persona_id ?? '').trim();
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return `El id de persona "${id}" no es válido.`;
      // Solo sus asistencias, filtradas en el servidor.
      const [sessions, registros, personas] = await Promise.all([
        c.cargarSesiones(),
        c.asistenciasDePersona(id),
        c.cargarPersonas(),
      ]);
      return informeHistorial(
        sessions,
        registros.map((r) => r.datos),
        personas,
        id,
      );
    },
  },
  {
    name: 'por_revisar',
    title: 'Personas esperando revisión',
    description:
      'Las personas que una coordinadora agregó en plena reunión y que todavía no ' +
      'forman parte de la lista oficial, para que la administración las apruebe, ' +
      'las una con alguien que ya existía o las descarte.',
    alcance: 'admin',
    inputSchema: objeto(),
    async ejecutar(c) {
      return informePorRevisar(await c.cargarPersonas());
    },
  },
  /* --------------------------------------------------------------- */
  /* ESCRITURA — solo administración, y siempre en dos pasos           */
  /* --------------------------------------------------------------- */
  {
    name: 'preparar_crear_reunion',
    title: 'Preparar: crear una reunión',
    description:
      'Prepara la creación de una reunión (no la crea todavía: devuelve un ' +
      'borrador para revisar). Si ya existe una de ese tipo ese día, lo dice y da ' +
      'su id: usa esa. Muéstrale el borrador a la persona y solo llama a ' +
      '"confirmar_operacion" cuando lo apruebe explícitamente.',
    alcance: 'escribir',
    inputSchema: objeto(
      {
        tipo: { type: 'string', enum: ['pasos', 'ego'] },
        modalidad: { type: 'string', enum: ['presencial', 'virtual'] },
        fecha: txt('Fecha en formato AAAA-MM-DD (día en Colombia)'),
        coordinadora: txt('Quién coordina (opcional)'),
        otra_mas: {
          type: 'boolean',
          default: false,
          description:
            'true SOLO si de verdad hay dos reuniones del mismo tipo el mismo día.',
        },
      },
      ['tipo', 'modalidad', 'fecha'],
    ),
    ejecutar: (c, a) =>
      prepararCrearReunion(
        c,
        a.tipo,
        a.modalidad,
        a.fecha,
        a.coordinadora ? String(a.coordinadora) : undefined,
        a.otra_mas === true,
      ),
  },
  {
    name: 'preparar_marcar_presente',
    title: 'Preparar: marcar a alguien presente',
    description:
      'Prepara marcar a una persona como presente en una reunión. Devuelve un ' +
      'borrador; no cambia nada hasta confirmar.',
    alcance: 'escribir',
    inputSchema: objeto({ reunion_id: txt('id de la reunión'), persona_id: txt('id de la persona') },
      ['reunion_id', 'persona_id']),
    ejecutar: (c, a) => prepararMarcar(c, a.reunion_id, a.persona_id, false),
  },
  {
    name: 'preparar_agregar_participante',
    title: 'Preparar: agregar a alguien que no está en la lista',
    description:
      'Para alguien que asistió pero no tiene ficha (buscar_persona no lo ' +
      'encuentra). Igual que cuando una coordinadora lo agrega en plena reunión: ' +
      'queda presente en esa reunión y en la bandeja "por revisar", SIN entrar a ' +
      'la lista oficial. Si ya existe una ficha parecida, el borrador la muestra: ' +
      'en ese caso usa preparar_marcar_presente con esa ficha en vez de crear otra. ' +
      'Devuelve un borrador; no cambia nada hasta confirmar.',
    alcance: 'escribir',
    inputSchema: objeto(
      {
        reunion_id: txt('id de la reunión'),
        nombre: txt('Nombre completo de la persona, tal como se quiere registrar'),
      },
      ['reunion_id', 'nombre'],
    ),
    ejecutar: (c, a) => prepararAgregarParticipante(c, a.reunion_id, a.nombre),
  },
  {
    name: 'preparar_quitar_presente',
    title: 'Preparar: quitar a alguien de la lista',
    description:
      'Prepara quitar a una persona de la asistencia de una reunión. Devuelve un ' +
      'borrador; no cambia nada hasta confirmar.',
    alcance: 'escribir',
    inputSchema: objeto({ reunion_id: txt('id de la reunión'), persona_id: txt('id de la persona') },
      ['reunion_id', 'persona_id']),
    ejecutar: (c, a) => prepararMarcar(c, a.reunion_id, a.persona_id, true),
  },
  {
    name: 'preparar_cerrar_reunion',
    title: 'Preparar: cerrar o reabrir una reunión',
    description:
      'Prepara cerrar una reunión (o reabrirla, con abrir=true). Al cerrarla, las ' +
      'coordinadoras dejan de poder modificarla. Devuelve un borrador.',
    alcance: 'escribir',
    inputSchema: objeto(
      {
        reunion_id: txt('id de la reunión'),
        abrir: { type: 'boolean', default: false, description: 'true = reabrir en vez de cerrar' },
      },
      ['reunion_id'],
    ),
    ejecutar: (c, a) => prepararEstadoReunion(c, a.reunion_id, a.abrir !== true),
  },
  {
    name: 'preparar_aprobar_persona',
    title: 'Preparar: aprobar a una persona nueva',
    description:
      'Prepara aprobar a una persona que está esperando revisión, opcionalmente ' +
      'corrigiendo su nombre (se corrige también en sus asistencias, como en la ' +
      'app). Si ya hay una ficha parecida en la lista oficial, el borrador lo ' +
      'avisa: en ese caso hay que unirlas desde la app, no aprobar. Devuelve un ' +
      'borrador.',
    alcance: 'escribir',
    inputSchema: objeto(
      { persona_id: txt('id de la persona'), nombre: txt('Nombre completo corregido (opcional)') },
      ['persona_id'],
    ),
    ejecutar: (c, a) =>
      prepararAprobarPersona(c, a.persona_id, a.nombre ? String(a.nombre) : undefined),
  },
  {
    name: 'confirmar_operacion',
    title: 'Confirmar y ejecutar',
    description:
      'EJECUTA de verdad una operación preparada antes. Úsalo SOLO después de ' +
      'haberle mostrado el borrador a la persona y de que lo haya aprobado de ' +
      'forma explícita en ese mismo momento. Si duda o corrige algo, prepara uno ' +
      'nuevo en vez de confirmar el anterior. Copia el confirmacion_id completo, ' +
      'tal cual. Confirmar dos veces el mismo borrador no repite nada.',
    alcance: 'escribir',
    inputSchema: objeto({ confirmacion_id: txt('El identificador que devolvió el borrador') },
      ['confirmacion_id']),
    ejecutar: (c, a) => ejecutar(c, desempaquetar(String(a.confirmacion_id), c.uid)),
  },
  {
    name: 'refrescar',
    title: 'Releer los datos',
    description:
      'Vacía la caché de un minuto y vuelve a leer todo. Útil si acaban de tomar ' +
      'asistencia y quieres los datos al segundo.',
    alcance: 'todos',
    inputSchema: objeto(),
    async ejecutar(c) {
      olvidar(c.uid);
      const [sessions, attendance] = await Promise.all([
        c.cargarSesiones(),
        c.cargarAsistencia(),
      ]);
      return `Datos releídos: ${sessions.length} reuniones y ${attendance.length} asistencias.`;
    },
  },
];

const ROL_LEGIBLE: Record<string, string> = {
  super_admin: 'Super administrador(a) — lectura y escritura',
  admin: 'Administrador(a) — lectura y escritura',
  coordinador: 'Coordinador(a) — SOLO LECTURA',
};

/** Las herramientas que puede ver y usar esta persona, según su rol. */
export function catalogoPara(c: Cliente) {
  return HERRAMIENTAS.filter((h) => h.alcance === 'todos' || c.esAdmin).map(
    ({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema }),
  );
}

export function buscarHerramienta(nombre: string): Herramienta | undefined {
  return HERRAMIENTAS.find((h) => h.name === nombre);
}

/**
 * ¿Puede esta persona usar esta herramienta?
 *
 * Coordinación: solo lo marcado 'todos', y todo eso es de consulta.
 * Administración: todo, incluida la escritura.
 */
export function permitida(h: Herramienta, c: Cliente): boolean {
  return h.alcance === 'todos' || c.esAdmin;
}
