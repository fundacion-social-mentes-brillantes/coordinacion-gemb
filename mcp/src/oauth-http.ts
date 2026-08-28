import { atenderOauth, type Peticion, type Respuesta } from './oauth';

/**
 * Punto de entrada de todo lo de "entrar con Google".
 *
 * Vercel dirige aquí varias direcciones (ver vercel.json) y cada una llega con
 * ?ruta=… para saber cuál es. Una sola función en vez de cinco: arranca en
 * frío una vez y se mantiene caliente para las siguientes.
 */
export default async function handler(req: Peticion, res: Respuesta) {
  const ruta = new URL(req.url ?? '', 'https://x').searchParams.get('ruta') ?? '';
  await atenderOauth(req, res, ruta);
}
