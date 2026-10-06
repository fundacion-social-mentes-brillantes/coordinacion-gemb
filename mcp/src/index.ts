#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { buscarHerramienta, catalogoPara, permitida } from './herramientas';
import { AccesoError, ConfigError, abrirSesion, type Cliente } from './rest';

// ---------------------------------------------------------------------------
//  El mismo servidor, por terminal, SOLO para desarrollar. La llave se toma
//  de GEMB_LLAVE y hay que compilarlo antes (npx esbuild mcp/src/index.ts
//  --bundle --platform=node --outfile=mcp/dist/index.js).
//
//  Para el uso diario está la versión de Vercel (.mcp.json ya apunta ahí):
//  funciona desde el celular y desde cualquier Claude, se entra con Google y
//  no hay que instalar nada.
// ---------------------------------------------------------------------------

process.env.TZ = 'America/Bogota';

const server = new Server(
  { name: 'coordinacion-gemb', version: '3.0.0' },
  { capabilities: { tools: {} } },
);

// La sesión se reutiliza mientras el permiso de Firestore siga vigente (dura
// una hora). Antes se guardaba para siempre, incluido un error: al rato
// todas las consultas fallaban y había que reiniciar el servidor.
let abierta: Promise<Cliente> | null = null;
let vence = 0;
function obtener(): Promise<Cliente> {
  if (abierta && Date.now() < vence - 5 * 60_000) return abierta;
  vence = Number.POSITIVE_INFINITY; // mientras se abre, no se reabre en paralelo
  const nueva = abrirSesion(process.env.GEMB_LLAVE ?? '').then(
    (c) => {
      vence = c.expira;
      return c;
    },
    (e) => {
      abierta = null;
      vence = 0;
      throw e;
    },
  );
  abierta = nueva;
  return nueva;
}

const texto = (t: string, esError = false) => ({
  content: [{ type: 'text' as const, text: t }],
  ...(esError ? { isError: true } : {}),
});

function explicar(e: unknown): string {
  return e instanceof ConfigError || e instanceof AccesoError
    ? e.message
    : `No se pudo consultar: ${e instanceof Error ? e.message : String(e)}`;
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    return { tools: catalogoPara(await obtener()) };
  } catch {
    // Sin llave válida se ofrece una sola herramienta, que explica qué falta
    // (una lista vacía no le dice a nadie por qué el servidor "no tiene nada").
    return {
      tools: [
        {
          name: 'quien_soy',
          description:
            'Ahora mismo la conexión no está completa; llámala para saber por qué.',
          inputSchema: { type: 'object' as const, properties: {}, required: [] },
        },
      ],
    };
  }
});

server.setRequestHandler(CallToolRequestSchema, async (peticion) => {
  let cliente: Cliente;
  try {
    cliente = await obtener();
  } catch (e) {
    return texto(explicar(e), true);
  }

  const herramienta = buscarHerramienta(peticion.params.name);
  if (!herramienta) {
    return texto(`No existe la herramienta "${peticion.params.name}".`, true);
  }
  if (!permitida(herramienta, cliente)) {
    return texto(
      `"${peticion.params.name}" es solo para administración, y tu cuenta ` +
        `(${cliente.email}) entra como coordinador(a).`,
      true,
    );
  }

  try {
    return texto(
      await herramienta.ejecutar(
        cliente,
        (peticion.params.arguments ?? {}) as Record<string, unknown>,
      ),
    );
  } catch (e) {
    return texto(explicar(e), true);
  }
});

server.connect(new StdioServerTransport()).catch((e) => {
  // stderr, nunca stdout: stdout es el canal del protocolo.
  console.error('[coordinacion-gemb] No se pudo arrancar:', e);
  process.exit(1);
});
