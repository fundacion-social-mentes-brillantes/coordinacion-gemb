import { timingSafeEqual } from 'node:crypto';
import {
  avisarManana,
  avisoDePrueba,
  docsDe,
  enviadoresReales,
  hoyEnBogota,
  permisoDeServidor,
  type Google,
} from './avisos';

// ---------------------------------------------------------------------------
//  /api/avisos — el aviso del día antes (ver avisos.ts).
//
//   GET   lo llama el cron de Vercel a las 9 a. m. de Bogotá (vercel.json),
//         con «Authorization: Bearer CRON_SECRET». Avisa a quien coordina
//         mañana. Con ?hoy=aaaa-mm-dd hace como si hoy fuera esa fecha
//         (para probar), también solo con el secreto.
//   POST  {accion:'prueba'} con el permiso de Firebase de la persona: le
//         manda un aviso de muestra a SUS dispositivos y a nadie más.
//
//  Este archivo es la FUENTE: Vercel despliega api/avisos.js
//  (npm run build:api).
// ---------------------------------------------------------------------------

/** Llave pública de la app web: viaja en el bundle del navegador, no es secreta. */
const API_KEY = 'AIzaSyB-KQMYvpKun5oxQhqTSyF-ElhJxAp-eGQ';

interface Req {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Res {
  status: (n: number) => Res;
  setHeader: (k: string, v: string) => void;
  json: (b: unknown) => void;
  end: (b?: string) => void;
}

const cabecera = (req: Req, k: string) => {
  const v = req.headers[k];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};
const portador = (req: Req) => cabecera(req, 'authorization').replace(/^Bearer\s+/i, '').trim();

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// El permiso de Google dura una hora: se reusa mientras la función siga viva.
let permiso: { token: string; hasta: number } | null = null;

async function google(req: Req): Promise<Google> {
  if (permiso && permiso.hasta - Date.now() > 5 * 60_000) return { docs: docsDe(), token: permiso.token };
  // Vercel pone su certificado en cada llamada (federación OIDC).
  const oidc = cabecera(req, 'x-vercel-oidc-token') || process.env.VERCEL_OIDC_TOKEN || '';
  if (!oidc) throw new Error('Falta el certificado de Vercel (OIDC)');
  permiso = await permisoDeServidor(oidc);
  return { docs: docsDe(), token: permiso.token };
}

/** ¿De quién es este permiso de Firebase? (Google lo comprueba.) */
async function uidDe(idToken: string): Promise<string | null> {
  if (!idToken) return null;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!r.ok) return null;
  const d = (await r.json()) as { users?: { localId?: string }[] };
  return d.users?.[0]?.localId ?? null;
}

// «Probar aviso» una vez cada 20 s por cuenta: no hay por qué más.
const ultimaPrueba = new Map<string, number>();

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const secreto = process.env.CRON_SECRET ?? '';
      if (!secreto || !igual(portador(req), secreto)) {
        res.status(401).json({ error: 'No autorizado' });
        return;
      }
      const hoy = new URL(req.url ?? '', 'https://x').searchParams.get('hoy');
      const g = await google(req);
      const resumen = await avisarManana(
        g,
        enviadoresReales(g, process.env.VAPID_PRIVADA),
        hoy && /^\d{4}-\d{2}-\d{2}$/.test(hoy) ? hoy : hoyEnBogota(),
      );
      console.log('avisos del día antes', JSON.stringify(resumen));
      res.status(200).json(resumen);
      return;
    }

    if (req.method === 'POST') {
      const cuerpo = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as { accion?: string };
      if (cuerpo.accion !== 'prueba') {
        res.status(400).json({ error: 'Acción desconocida' });
        return;
      }
      const uid = await uidDe(portador(req));
      if (!uid) {
        res.status(401).json({ error: 'Vuelve a entrar a la app' });
        return;
      }
      const antes = ultimaPrueba.get(uid) ?? 0;
      if (Date.now() - antes < 20_000) {
        res.status(429).json({ error: 'Espera unos segundos y vuelve a probar' });
        return;
      }
      ultimaPrueba.set(uid, Date.now());
      const g = await google(req);
      const r = await avisoDePrueba(g, enviadoresReales(g, process.env.VAPID_PRIVADA), uid);
      res.status(200).json(r);
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('avisos: falló', e);
    res.status(500).json({ error: 'No se pudo mandar el aviso' });
  }
}
