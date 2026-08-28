import { buscarHerramienta, catalogoPara, permitida } from './herramientas';
import { AccesoError, ConfigError, abrirSesion, type Cliente } from './rest';

// ---------------------------------------------------------------------------
//  Servidor MCP por HTTP, desplegado junto a la app en Vercel.
//
//  Cada persona lo conecta a SU Claude con SU propia llave, sacada de la app.
//  El servidor no guarda ningún secreto: la llave llega en cada petición, se
//  canjea por un permiso de una hora y se descarta. Si el servidor se ve
//  comprometido, no hay nada que robar.
//
//  Quién ve qué lo deciden dos capas, no este archivo:
//    1. El rol de la persona en la app filtra la lista de herramientas.
//    2. Las reglas de Firestore filtran los datos de verdad.
//
//  Protocolo JSON-RPC escrito a mano y sin estado: es lo que encaja con una
//  función que se apaga entre llamada y llamada.
//
//  Este archivo es la FUENTE. Lo que Vercel despliega es api/mcp.js, que se
//  genera empaquetando todo en uno solo (npm run build:api): Vercel compila
//  cada archivo de api/ por separado y no arrastra los módulos de otras
//  carpetas.
// ---------------------------------------------------------------------------

/**
 * Versiones del protocolo que se saben hablar, de la más nueva a la más
 * vieja. Hay que responder la que pide el cliente: si se le contesta con otra,
 * los clientes estrictos cortan la conexión ("no se pudo conectar").
 */
const VERSIONES = ['2025-06-18', '2025-03-26', '2024-11-05'];
const VERSION_PROTOCOLO = VERSIONES[0];

function versionAcordada(params?: Record<string, unknown>): string {
  const pedida = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
  return VERSIONES.includes(pedida) ? pedida : VERSION_PROTOCOLO;
}

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
const respuestaTexto = (id: Peticion['id'], texto: string, esError = false) =>
  ok(id, { content: [{ type: 'text', text: texto }], ...(esError ? { isError: true } : {}) });

/**
 * Métodos que se atienden ANTES de validar la llave, para que añadir el
 * conector no falle en el saludo inicial y el error salga donde se lee.
 */
function saludo(p: Peticion): object | null | undefined {
  switch (p.method) {
    case 'initialize':
      return ok(p.id, {
        protocolVersion: versionAcordada(p.params),
        capabilities: { tools: {} },
        serverInfo: { name: 'coordinacion-gemb', version: '3.0.0' },
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return ok(p.id, {});
    default:
      return undefined;
  }
}

async function atender(p: Peticion, obtener: () => Promise<Cliente>): Promise<object | null> {
  const previo = saludo(p);
  if (previo !== undefined) return previo;

  let cliente: Cliente;
  try {
    cliente = await obtener();
  } catch (e) {
    const mensaje =
      e instanceof ConfigError || e instanceof AccesoError
        ? e.message
        : `No se pudo validar la llave: ${e instanceof Error ? e.message : String(e)}`;
    // Como texto y no como fallo de protocolo: así el mensaje (que dice cómo
    // arreglarlo) llega a la persona en vez de morir en el transporte.
    // Nunca devolver una lista vacía: el conector se vería "sin herramientas"
    // y nadie sabría por qué. Se ofrece una sola, que explica qué falta.
    if (p.method === 'tools/list') {
      return ok(p.id, {
        tools: [
          {
            name: 'quien_soy',
            title: 'Revisar la conexión',
            description:
              'Dice con qué cuenta está conectado Claude y qué puede hacer. ' +
              'Ahora mismo la conexión no está completa; llámala para saber por qué.',
            inputSchema: { type: 'object', properties: {}, required: [] },
          },
        ],
      });
    }
    return respuestaTexto(p.id, mensaje, true);
  }

  switch (p.method) {
    case 'tools/list':
      return ok(p.id, { tools: catalogoPara(cliente) });

    case 'tools/call': {
      const nombre = String(p.params?.name ?? '');
      const herramienta = buscarHerramienta(nombre);
      if (!herramienta) return fallo(p.id, -32602, `No existe la herramienta "${nombre}".`);

      if (!permitida(herramienta, cliente)) {
        return respuestaTexto(
          p.id,
          `"${nombre}" es solo para administración, y tu cuenta (${cliente.email}) ` +
            'entra como coordinador(a). Puedes consultar las reuniones y cómo va ' +
            'el grupo; el detalle de una persona concreta y la bandeja de revisión, no.',
          true,
        );
      }

      try {
        const texto = await herramienta.ejecutar(
          cliente,
          (p.params?.arguments ?? {}) as Record<string, unknown>,
        );
        return respuestaTexto(p.id, texto);
      } catch (e) {
        if (e instanceof AccesoError && e.message === 'PERMISSION_DENIED') {
          return respuestaTexto(
            p.id,
            'Las reglas de la app no dejan a tu cuenta leer eso. Si crees que ' +
              'debería, pide que revisen tu rol en Usuarios.',
            true,
          );
        }
        const mensaje =
          e instanceof ConfigError || e instanceof AccesoError
            ? e.message
            : `No se pudo consultar: ${e instanceof Error ? e.message : String(e)}`;
        return respuestaTexto(p.id, mensaje, true);
      }
    }

    default:
      return fallo(p.id, -32601, `Método no soportado: ${p.method}`);
  }
}

interface Req {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/**
 * De dónde sale la llave de la persona.
 *
 * Lo más limpio sería solo la cabecera Authorization, pero la pantalla de
 * conectores de claude.ai únicamente pide una dirección: no hay dónde poner
 * cabeceras. Así que también se acepta en la propia URL (?k=…), que es lo que
 * permite instalarlo desde el celular sin pelearse con nada.
 */
function llaveDe(req: Req): string {
  const cabecera = req.headers.authorization;
  const enCabecera = (Array.isArray(cabecera) ? cabecera[0] : cabecera ?? '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (enCabecera) return enCabecera;

  try {
    const u = new URL(req.url ?? '', 'http://x');
    return (u.searchParams.get('k') ?? u.searchParams.get('llave') ?? '').trim();
  } catch {
    return '';
  }
}
interface Res {
  status: (n: number) => Res;
  setHeader: (k: string, v: string) => void;
  json: (b: unknown) => void;
  end: (b?: string) => void;
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    // Un cliente MCP abre un GET para escuchar mensajes que empiece el
    // servidor. Aquí no se empieza ninguno (cada consulta va y vuelve por
    // POST), así que hay que decirlo con un 405 limpio: devolverle JSON lo
    // deja esperando algo que nunca llega y la conexión se da por fallida.
    const acepta = req.headers.accept;
    const quiereFlujo = (Array.isArray(acepta) ? acepta.join(',') : acepta ?? '').includes(
      'text/event-stream',
    );
    if (quiereFlujo) {
      res.setHeader('Allow', 'POST, OPTIONS');
      res.status(405).json(fallo(null, -32600, 'Este servidor solo atiende por POST.'));
      return;
    }
  }

  if (req.method === 'GET') {
    // Sonda de vida. No revela nada: quién puede consultar depende de la llave
    // que traiga cada quien, no de una configuración del servidor.
    res.status(200).json({
      nombre: 'coordinacion-gemb',
      mcp: VERSION_PROTOCOLO,
      estado: 'en pie',
      como_conectar:
        'Cada persona usa su propia llave: app → Panel → "Conectar con Claude". ' +
        'Se pega como cabecera Authorization: Bearer <llave>.',
    });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json(fallo(null, -32600, 'Usa POST.'));
    return;
  }

  const llave = llaveDe(req);

  // Sin llave: se responde 401 diciendo dónde se entra con Google. Eso es lo
  // que hace que el cliente ofrezca "Conectar" en vez de quedarse mudo.
  // Excepción: initialize y las notificaciones, para que el saludo no falle.
  if (!llave) {
    const cuerpoPrevio = req.body;
    const lista: Peticion[] = Array.isArray(cuerpoPrevio)
      ? (cuerpoPrevio as Peticion[])
      : [(cuerpoPrevio ?? {}) as Peticion];
    const soloSaludo = lista.every((p) => saludo(p) !== undefined);
    if (!soloSaludo) {
      res.setHeader(
        'WWW-Authenticate',
        'Bearer realm="coordinacion-gemb", ' +
          'resource_metadata="https://coordinacion-gemb.vercel.app/.well-known/oauth-protected-resource"',
      );
      res.status(401).json(
        fallo(null, -32001, 'Hay que entrar con Google. Conecta el conector desde Claude.'),
      );
      return;
    }
  }

  // Se abre una sola vez por petición aunque vengan varias llamadas juntas.
  let abierta: Promise<Cliente> | null = null;
  const obtener = () => (abierta ??= abrirSesion(llave));

  const cuerpo = req.body;
  const peticiones: Peticion[] = Array.isArray(cuerpo)
    ? (cuerpo as Peticion[])
    : [(cuerpo ?? {}) as Peticion];

  const respuestas: object[] = [];
  for (const p of peticiones) {
    const r = await atender(p, obtener);
    if (r !== null) respuestas.push(r);
  }

  if (respuestas.length === 0) {
    res.status(202).end();
    return;
  }
  res.status(200).json(Array.isArray(cuerpo) ? respuestas : respuestas[0]);
}
