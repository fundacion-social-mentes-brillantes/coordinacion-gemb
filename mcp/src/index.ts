#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { CATALOGO, buscarHerramienta } from './herramientas';
import { AccesoError, ConfigError } from './rest';

// ---------------------------------------------------------------------------
//  El mismo servidor, por terminal.
//
//  Comparte el registro de herramientas con la versión HTTP (api/mcp.ts), así
//  que las dos ofrecen exactamente lo mismo. Para el uso diario conviene la
//  de Vercel: funciona desde el celular y desde cualquier sesión. Esta sirve
//  para desarrollar y para trabajar sin conexión a ese despliegue.
//
//  Solo lee. La única escritura de todo el proyecto es el registro inicial de
//  su propia cuenta dentro de la app, y ocurre una sola vez (ver rest.ts).
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'coordinacion-gemb', version: '2.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: CATALOGO }));

server.setRequestHandler(CallToolRequestSchema, async (peticion) => {
  const herramienta = buscarHerramienta(peticion.params.name);
  if (!herramienta) {
    return {
      content: [
        { type: 'text' as const, text: `No existe la herramienta "${peticion.params.name}".` },
      ],
      isError: true,
    };
  }
  try {
    const texto = await herramienta.ejecutar(
      (peticion.params.arguments ?? {}) as Record<string, unknown>,
    );
    return { content: [{ type: 'text' as const, text: texto }] };
  } catch (e) {
    // Los problemas de configuración o permisos se devuelven como resultado,
    // con su mensaje de "cómo arreglarlo", en vez de como caída del protocolo.
    const mensaje =
      e instanceof ConfigError || e instanceof AccesoError
        ? e.message
        : `No se pudo consultar: ${e instanceof Error ? e.message : String(e)}`;
    return { content: [{ type: 'text' as const, text: mensaje }], isError: true };
  }
});

server.connect(new StdioServerTransport()).catch((e) => {
  // stderr, nunca stdout: stdout es el canal del protocolo.
  console.error('[coordinacion-gemb] No se pudo arrancar:', e);
  process.exit(1);
});
