import {
  CATALOGO,
  buscarHerramienta,
} from './herramientas';
import { AccesoError, ConfigError } from './rest';

// ---------------------------------------------------------------------------
//  Servidor MCP por HTTP, desplegado junto a la app en Vercel.
//
//  Existe para que las consultas funcionen desde CUALQUIER sitio —el celular,
//  Claude Code web, otro computador— y no solo desde la máquina donde alguien
//  dejó unas credenciales. Los datos de la cuenta de lectura viven en las
//  variables de entorno de Vercel; nunca viajan por el chat.
//
//  Protocolo JSON-RPC escrito a mano y sin estado: es lo que encaja con una
//  función que se apaga entre llamada y llamada, y evita arrastrar
//  dependencias que harían lento el arranque en frío.
//
//  Este archivo es la FUENTE. Lo que Vercel despliega es api/mcp.js, que se
//  genera empaquetando todo en uno solo (npm run build:api). Hace falta
//  porque Vercel compila cada archivo de api/ por separado y no arrastra los
//  módulos de otras carpetas: al desplegarlo sin empaquetar, la función
//  arrancaba y moría con ERR_MODULE_NOT_FOUND.
// ---------------------------------------------------------------------------

const VERSION_PROTOCOLO = '2024-11-05';

interface Peticion {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const ok = (id: Peticion['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const fallo = (id: Peticion['id'], code: number, message: string) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

async function atender(p: Peticion): Promise<object | null> {
  switch (p.method) {
    case 'initialize':
      return ok(p.id, {
        protocolVersion: VERSION_PROTOCOLO,
        capabilities: { tools: {} },
        serverInfo: { name: 'coordinacion-gemb', version: '2.0.0' },
      });

    // Las notificaciones no llevan respuesta.
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;

    case 'ping':
      return ok(p.id, {});

    case 'tools/list':
      return ok(p.id, { tools: CATALOGO });

    case 'tools/call': {
      const nombre = String(p.params?.name ?? '');
      const herramienta = buscarHerramienta(nombre);
      if (!herramienta) return fallo(p.id, -32602, `No existe la herramienta "${nombre}".`);

      const args = (p.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const texto = await herramienta.ejecutar(args);
        return ok(p.id, { content: [{ type: 'text', text: texto }] });
      } catch (e) {
        // Los problemas de configuración o de permisos se devuelven como
        // resultado con isError, no como fallo del protocolo: así el mensaje
        // (que dice cómo arreglarlo) llega a quien puede hacerlo.
        const mensaje =
          e instanceof ConfigError || e instanceof AccesoError
            ? e.message
            : `No se pudo consultar: ${e instanceof Error ? e.message : String(e)}`;
        return ok(p.id, { content: [{ type: 'text', text: mensaje }], isError: true });
      }
    }

    default:
      return fallo(p.id, -32601, `Método no soportado: ${p.method}`);
  }
}

interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status: (n: number) => Res;
  setHeader: (k: string, v: string) => void;
  json: (b: unknown) => void;
  end: (b?: string) => void;
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    // Sonda de vida: no revela nada ni exige credenciales.
    res.status(200).json({ nombre: 'coordinacion-gemb', mcp: VERSION_PROTOCOLO, estado: 'en pie' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json(fallo(null, -32600, 'Usa POST.'));
    return;
  }

  // Sin token configurado, el servidor no atiende: mejor cerrado que abierto.
  const esperado = process.env.GEMB_MCP_TOKEN;
  if (!esperado) {
    res.status(503).json(
      fallo(null, -32000, 'Falta GEMB_MCP_TOKEN en el servidor: nadie puede consultar todavía.'),
    );
    return;
  }
  const cabecera = req.headers.authorization;
  const recibido = (Array.isArray(cabecera) ? cabecera[0] : cabecera ?? '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (recibido !== esperado) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json(fallo(null, -32001, 'Token inválido o ausente.'));
    return;
  }

  const cuerpo = req.body;
  const peticiones: Peticion[] = Array.isArray(cuerpo)
    ? (cuerpo as Peticion[])
    : [(cuerpo ?? {}) as Peticion];

  const respuestas = (await Promise.all(peticiones.map(atender))).filter(
    (r): r is object => r !== null,
  );

  if (respuestas.length === 0) {
    res.status(202).end();
    return;
  }
  res.status(200).json(Array.isArray(cuerpo) ? respuestas : respuestas[0]);
}
