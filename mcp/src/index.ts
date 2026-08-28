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
//  El mismo servidor, por terminal, para desarrollar o para usarlo sin pasar
//  por el despliegue. La llave se toma de GEMB_LLAVE.
//
//  Para el uso diario conviene la versión de Vercel: funciona desde el celular
//  y desde cualquier Claude, y no hay que instalar nada.
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'coordinacion-gemb', version: '3.0.0' },
  { capabilities: { tools: {} } },
);

let abierta: Promise<Cliente> | null = null;
const obtener = () => (abierta ??= abrirSesion(process.env.GEMB_LLAVE ?? ''));

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
    // Sin llave válida no se anuncia nada; el porqué se explica al llamar.
    return { tools: [] };
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
