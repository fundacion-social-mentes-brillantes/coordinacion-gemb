import {
  cargarAsistencia,
  cargarPersonas,
  cargarSesiones,
  limpiarCache,
} from './rest';
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
//  Las herramientas, definidas UNA vez.
//
//  Las usan los dos frentes: el servidor por HTTP (api/mcp.ts, desplegado en
//  Vercel) y el servidor por terminal (index.ts). El esquema va en JSON Schema
//  plano a propósito, sin zod: así la función de Vercel no arrastra
//  dependencias y arranca en frío rápido.
// ---------------------------------------------------------------------------

export interface Herramienta {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  ejecutar: (args: Record<string, unknown>) => Promise<string>;
}

const objeto = (
  properties: Record<string, unknown> = {},
  required: string[] = [],
) => ({ type: 'object', properties, required });

const txt = (description: string) => ({ type: 'string', description });

export const HERRAMIENTAS: Herramienta[] = [
  {
    name: 'como_vamos',
    title: '¿Cómo vamos?',
    description:
      'Responde cuántas personas están viniendo ÚLTIMAMENTE a un tipo de reunión ' +
      '(no en todo el año): la cifra, si subió o bajó frente al período anterior, ' +
      'el promedio de presentes por reunión y el reparto en grupos (firmes, nuevas, ' +
      'van y vienen, se están alejando) con los nombres. Es el mismo cálculo que ' +
      'muestra el apartado "¿Cómo vamos?" del Panel de la app.',
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
      con_nombres: {
        type: 'boolean',
        default: true,
        description: 'Incluir los nombres de cada grupo.',
      },
    }),
    async ejecutar(a) {
      const [sessions, attendance] = await Promise.all([
        cargarSesiones(),
        cargarAsistencia(),
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
    name: 'conteos',
    title: 'Conteos generales',
    description:
      'Totales rápidos: personas en la lista (activas y totales), reuniones ' +
      'registradas por tipo, y cuántas personas nuevas esperan revisión.',
    inputSchema: objeto(),
    async ejecutar() {
      const [sessions, personas] = await Promise.all([
        cargarSesiones(),
        cargarPersonas(),
      ]);
      return informeConteos(sessions, personas);
    },
  },
  {
    name: 'reuniones',
    title: 'Listar reuniones',
    description:
      'Las reuniones más recientes, con fecha, tipo, modalidad, quién coordinó, ' +
      'cuántas personas asistieron y si la sesión sigue abierta. Devuelve el id ' +
      'de cada una para consultar su lista.',
    inputSchema: objeto({
      tipo: { type: 'string', enum: ['pasos', 'ego', 'todas'], default: 'todas' },
      limite: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
    }),
    async ejecutar(a) {
      const [sessions, attendance] = await Promise.all([
        cargarSesiones(),
        cargarAsistencia(),
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
    inputSchema: objeto({ reunion_id: txt('id de la reunión') }, ['reunion_id']),
    async ejecutar(a) {
      const [sessions, attendance] = await Promise.all([
        cargarSesiones(),
        cargarAsistencia(),
      ]);
      return informeAsistenciaReunion(sessions, attendance, String(a.reunion_id));
    },
  },
  {
    name: 'buscar_persona',
    title: 'Buscar una persona',
    description:
      'Busca personas por nombre (tolera acentos, mayúsculas y orden de las ' +
      'palabras) y devuelve su id para consultar el historial. No devuelve ' +
      'teléfonos ni notas.',
    inputSchema: objeto({ nombre: txt('Nombre o parte del nombre') }, ['nombre']),
    async ejecutar(a) {
      return informeBuscarPersona(await cargarPersonas(), String(a.nombre));
    },
  },
  {
    name: 'historial_persona',
    title: 'Historial de una persona',
    description:
      'Todas las veces que una persona ha asistido, separadas por tipo de reunión, ' +
      'con su porcentaje de asistencia. El id se obtiene con "buscar_persona".',
    inputSchema: objeto({ persona_id: txt('id de la persona') }, ['persona_id']),
    async ejecutar(a) {
      const [sessions, attendance, personas] = await Promise.all([
        cargarSesiones(),
        cargarAsistencia(),
        cargarPersonas(),
      ]);
      return informeHistorial(sessions, attendance, personas, String(a.persona_id));
    },
  },
  {
    name: 'por_revisar',
    title: 'Personas esperando revisión',
    description:
      'Las personas que una coordinadora agregó en plena reunión y que todavía no ' +
      'forman parte de la lista oficial, para que la administración las apruebe, ' +
      'las una con alguien que ya existía o las descarte.',
    inputSchema: objeto(),
    async ejecutar() {
      return informePorRevisar(await cargarPersonas());
    },
  },
  {
    name: 'refrescar',
    title: 'Releer los datos',
    description:
      'Vacía la caché de un minuto y vuelve a leer todo. Útil si acaban de tomar ' +
      'asistencia y quieres los datos al segundo.',
    inputSchema: objeto(),
    async ejecutar() {
      limpiarCache();
      const [sessions, attendance] = await Promise.all([
        cargarSesiones(),
        cargarAsistencia(),
      ]);
      return `Datos releídos: ${sessions.length} reuniones y ${attendance.length} asistencias.`;
    },
  },
];

/** Para listar por el protocolo (sin la función). */
export const CATALOGO = HERRAMIENTAS.map(({ name, title, description, inputSchema }) => ({
  name,
  title,
  description,
  inputSchema,
}));

export function buscarHerramienta(nombre: string): Herramienta | undefined {
  return HERRAMIENTAS.find((h) => h.name === nombre);
}
