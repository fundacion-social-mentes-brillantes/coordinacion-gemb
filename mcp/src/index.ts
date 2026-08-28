#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  ConfigError,
  cargarAsistencia,
  cargarPersonas,
  cargarSesiones,
  limpiarCache,
} from './firestore';
import {
  informeAsistenciaReunion,
  informeBuscarPersona,
  informeComoVamos,
  informeConteos,
  informeHistorial,
  informePorRevisar,
  informeReuniones,
} from './informes';

// ---------------------------------------------------------------------------
//  Servidor MCP de la app de coordinación GEMB.
//
//  SOLO LECTURA, a propósito: la app tiene reglas cuidadas sobre quién puede
//  marcar asistencia y cuándo (sesión abierta o cerrada, rol de cada quien,
//  bandeja de revisión de las personas nuevas). Escribir desde aquí se las
//  saltaría todas, así que este servidor se limita a consultar.
//
//  Tampoco devuelve teléfonos ni las notas privadas de las fichas.
// ---------------------------------------------------------------------------

const texto = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

const server = new McpServer({ name: 'coordinacion-gemb', version: '1.0.0' });

server.registerTool(
  'como_vamos',
  {
    title: '¿Cómo vamos?',
    description:
      'Responde cuántas personas están viniendo ÚLTIMAMENTE a un tipo de reunión ' +
      '(no en todo el año): la cifra, si subió o bajó frente al período anterior, ' +
      'el promedio de presentes por reunión y el reparto en grupos (firmes, nuevas, ' +
      'van y vienen, se están alejando) con los nombres. Es el mismo cálculo que ' +
      'muestra el apartado "¿Cómo vamos?" del Panel de la app.',
    inputSchema: {
      tipo: z
        .enum(['pasos', 'ego'])
        .default('pasos')
        .describe('pasos = Entrega de Pasos; ego = Sala de Reducción del Ego'),
      ventana: z
        .number()
        .int()
        .min(1)
        .max(52)
        .default(4)
        .describe('Cuántas reuniones hacia atrás mirar. La app usa 4, 8 o 12.'),
      con_nombres: z.boolean().default(true).describe('Incluir los nombres de cada grupo.'),
    },
  },
  async ({ tipo, ventana, con_nombres }) => {
    const [sessions, attendance] = await Promise.all([cargarSesiones(), cargarAsistencia()]);
    return texto(informeComoVamos(sessions, attendance, tipo, ventana, con_nombres));
  },
);

server.registerTool(
  'conteos',
  {
    title: 'Conteos generales',
    description:
      'Totales rápidos: personas en la lista (activas y totales), reuniones ' +
      'registradas por tipo, y cuántas personas nuevas esperan revisión.',
    inputSchema: {},
  },
  async () => {
    const [sessions, personas] = await Promise.all([cargarSesiones(), cargarPersonas()]);
    return texto(informeConteos(sessions, personas));
  },
);

server.registerTool(
  'reuniones',
  {
    title: 'Listar reuniones',
    description:
      'Las reuniones más recientes, con fecha, tipo, modalidad, quién coordinó, ' +
      'cuántas personas asistieron y si la sesión sigue abierta. Devuelve el id ' +
      'de cada una para consultar su lista.',
    inputSchema: {
      tipo: z.enum(['pasos', 'ego', 'todas']).default('todas'),
      limite: z.number().int().min(1).max(100).default(10),
    },
  },
  async ({ tipo, limite }) => {
    const [sessions, attendance] = await Promise.all([cargarSesiones(), cargarAsistencia()]);
    return texto(informeReuniones(sessions, attendance, tipo, limite));
  },
);

server.registerTool(
  'asistencia_reunion',
  {
    title: 'Quiénes fueron a una reunión',
    description:
      'La lista de personas presentes en una reunión concreta. El id se obtiene ' +
      'con la herramienta "reuniones".',
    inputSchema: { reunion_id: z.string().min(1).describe('id de la reunión') },
  },
  async ({ reunion_id }) => {
    const [sessions, attendance] = await Promise.all([cargarSesiones(), cargarAsistencia()]);
    return texto(informeAsistenciaReunion(sessions, attendance, reunion_id));
  },
);

server.registerTool(
  'buscar_persona',
  {
    title: 'Buscar una persona',
    description:
      'Busca personas por nombre (tolera acentos, mayúsculas y orden de las ' +
      'palabras) y devuelve su id para consultar el historial. No devuelve ' +
      'teléfonos ni notas.',
    inputSchema: { nombre: z.string().min(2).describe('Nombre o parte del nombre') },
  },
  async ({ nombre }) => texto(informeBuscarPersona(await cargarPersonas(), nombre)),
);

server.registerTool(
  'historial_persona',
  {
    title: 'Historial de una persona',
    description:
      'Todas las veces que una persona ha asistido, separadas por tipo de reunión, ' +
      'con su porcentaje de asistencia. El id se obtiene con "buscar_persona".',
    inputSchema: { persona_id: z.string().min(1) },
  },
  async ({ persona_id }) => {
    const [sessions, attendance, personas] = await Promise.all([
      cargarSesiones(),
      cargarAsistencia(),
      cargarPersonas(),
    ]);
    return texto(informeHistorial(sessions, attendance, personas, persona_id));
  },
);

server.registerTool(
  'por_revisar',
  {
    title: 'Personas esperando revisión',
    description:
      'Las personas que una coordinadora agregó en plena reunión y que todavía no ' +
      'forman parte de la lista oficial, para que la administración las apruebe, ' +
      'las una con alguien que ya existía o las descarte.',
    inputSchema: {},
  },
  async () => texto(informePorRevisar(await cargarPersonas())),
);

server.registerTool(
  'refrescar',
  {
    title: 'Releer los datos',
    description:
      'Vacía la caché de un minuto y vuelve a leer todo de Firebase. Útil si acaban ' +
      'de tomar asistencia y quieres los datos al segundo.',
    inputSchema: {},
  },
  async () => {
    limpiarCache();
    const [sessions, attendance] = await Promise.all([cargarSesiones(), cargarAsistencia()]);
    return texto(
      `Datos releídos: ${sessions.length} reuniones y ${attendance.length} asistencias.`,
    );
  },
);

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  // stderr, nunca stdout: stdout es el canal del protocolo MCP.
  console.error(
    e instanceof ConfigError
      ? `[coordinacion-gemb] ${e.message}`
      : `[coordinacion-gemb] No se pudo arrancar: ${e}`,
  );
  process.exit(1);
});
