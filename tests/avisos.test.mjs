// Pruebas del aviso del día antes (mcp/src/avisos.ts) contra el emulador de
// Firestore: a quién se le avisa, qué dice, qué pasa con los teléfonos que ya
// no existen y que el cifrado de Web Push lo pueda abrir el navegador.
//
//   npm run test:mcp   (enciende los emuladores y corre esto también)
//
// El permiso «owner» del emulador hace de la cuenta del servidor: las dos se
// saltan las reglas.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const FS = process.env.FIRESTORE_EMULATOR_HOST;
assert.ok(FS, 'Corre esto con los emuladores: npm run test:mcp');
const PROYECTO = process.env.GCLOUD_PROJECT || 'demo-gemb';
const DOCS = `http://${FS}/v1/projects/${PROYECTO}/databases/(default)/documents`;

const salida = path.join(mkdtempSync(path.join(tmpdir(), 'avisos-')), 'avisos.mjs');
await build({
  entryPoints: [fileURLToPath(new URL('../mcp/src/avisos.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: salida,
  logLevel: 'warning',
});
const A = await import(pathToFileURL(salida).href);
const g = { docs: A.docsDe(`http://${FS}/v1`, PROYECTO), token: 'owner' };

// ------------------------------------------------------------ datos

const HOY = '2026-10-19'; // lunes
const MANANA = '2026-10-20'; // martes

const s = (v) => ({ stringValue: v });
const arr = (xs) => ({ arrayValue: { values: xs.map(s) } });
async function poner(ruta, fields) {
  const r = await fetch(`${DOCS}/${ruta}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  assert.ok(r.ok, `no se pudo poner ${ruta}: ${r.status}`);
}
async function existe(ruta) {
  const r = await fetch(`${DOCS}/${ruta}`, { headers: { Authorization: 'Bearer owner' } });
  return r.status === 200;
}
const telefono = (uid, nombre, token) => ({ uid: s(uid), nombre: s(nombre), plataforma: s('android'), token: s(token) });

before(async () => {
  await fetch(`http://${FS}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`, { method: 'DELETE' });
});

beforeEach(async () => {
  await fetch(`http://${FS}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`, { method: 'DELETE' });
  const dia = { mapValue: { fields: { activo: { booleanValue: true }, actividades: arr(['reduccion_ego']), horario: s('5:30 PM - 6:45 PM'), siempreVirtual: { booleanValue: false } } } };
  await poner('programacion/config', {
    coordinadoras: arr(['Jessica Becerra', 'Tatiana López']),
    desde: s('2026-01-10'),
    hasta: s('2026-12-15'),
    semanasVirtuales: s('par'),
    dias: { mapValue: { fields: { 2: dia } } },
  });
  await poner(`programacion_dias/${MANANA}`, { coordinadora: s('Jessica Becerra'), modalidad: s('virtual') });
  await poner('avisos/jessica__telefono01', telefono('jessica', 'Jessica Becerra', 'tok-bueno'));
  await poner('avisos/jessica__telefono02', telefono('jessica', 'Jessica Becerra', 'tok-caducado'));
  await poner('avisos/jessica__iphone0001', {
    uid: s('jessica'),
    nombre: s('Jessica Becerra'),
    plataforma: s('web'),
    suscripcion: { mapValue: { fields: { endpoint: s('https://push.ejemplo/x'), p256dh: s('BKx'), auth: s('aut') } } },
  });
  await poner('avisos/tatiana__telefono01', telefono('tatiana', 'Tatiana López', 'tok-tatiana'));
});

function enviadoresDePrueba() {
  const llamadas = [];
  return {
    llamadas,
    fcm: async (token, aviso) => {
      llamadas.push({ por: 'fcm', a: token, aviso });
      return token === 'tok-caducado' ? 'caducado' : 'ok';
    },
    web: async (sub, aviso) => {
      llamadas.push({ por: 'web', a: sub.endpoint, aviso });
      return 'ok';
    },
  };
}

// ------------------------------------------------------------ el reparto

test('avisa solo a los teléfonos de quien coordina mañana, con el texto del día', async () => {
  const env = enviadoresDePrueba();
  const r = await A.avisarManana(g, env, HOY);
  assert.equal(r.fecha, MANANA);
  assert.equal(r.coordinadora, 'Jessica Becerra');
  assert.deepEqual([r.enviados, r.caducados, r.fallidos], [2, 1, 0]);
  assert.deepEqual(env.llamadas.map((l) => l.a).sort(), ['https://push.ejemplo/x', 'tok-bueno', 'tok-caducado']);
  const { aviso } = env.llamadas[0];
  assert.equal(aviso.titulo, 'Mañana coordinas tú ✨');
  assert.match(aviso.cuerpo, /Sala de Reducción del Ego · martes 20 · virtual, 5:30 p\. m\./);
  assert.equal(aviso.ruta, '/sesiones');
  assert.equal(aviso.etiqueta, `coordinar-${MANANA}`);
});

test('el teléfono que ya no existe se borra de la lista', async () => {
  await A.avisarManana(g, enviadoresDePrueba(), HOY);
  assert.equal(await existe('avisos/jessica__telefono02'), false);
  assert.equal(await existe('avisos/jessica__telefono01'), true);
});

test('sin coordinadora, cancelada o festivo: no se avisa a nadie', async () => {
  await poner(`programacion_dias/${MANANA}`, { modalidad: s('virtual') });
  let env = enviadoresDePrueba();
  assert.equal((await A.avisarManana(g, env, HOY)).motivo, 'sin coordinadora');
  assert.equal(env.llamadas.length, 0);

  await poner(`programacion_dias/${MANANA}`, { coordinadora: s('Jessica Becerra'), cancelada: { booleanValue: true } });
  env = enviadoresDePrueba();
  assert.equal((await A.avisarManana(g, env, HOY)).motivo, 'no hay reunión');
  assert.equal(env.llamadas.length, 0);

  // Un martes festivo: el 8 de diciembre de 2026 (la Inmaculada Concepción).
  await poner('programacion_dias/2026-12-08', { coordinadora: s('Jessica Becerra') });
  env = enviadoresDePrueba();
  assert.equal((await A.avisarManana(g, env, '2026-12-07')).motivo, 'no hay reunión');
  assert.equal(env.llamadas.length, 0);
});

test('«Probar aviso» llega solo a los teléfonos de esa cuenta', async () => {
  const env = enviadoresDePrueba();
  const r = await A.avisoDePrueba(g, env, 'tatiana');
  assert.equal(r.dispositivos, 1);
  assert.equal(r.enviados, 1);
  assert.deepEqual(env.llamadas.map((l) => l.a), ['tok-tatiana']);
  assert.match(env.llamadas[0].aviso.titulo, /Así te llegará/);
});

// --------------------------------------------- Web Push de punta a punta

/** Lo que hace el navegador al recibir: descifrar (RFC 8291). */
function descifrar(cuerpo, ua, secreto) {
  const sal = cuerpo.subarray(0, 16);
  const largo = cuerpo.readUInt8(20);
  const suya = cuerpo.subarray(21, 21 + largo);
  const datos = cuerpo.subarray(21 + largo);
  const h = (k, d) => createHmac('sha256', k).update(d).digest();
  const ikm = h(h(secreto, ua.computeSecret(suya)), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), suya, Buffer.from([1])]));
  const prk = h(sal, ikm);
  const cek = h(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = h(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(datos.subarray(datos.length - 16));
  const claro = Buffer.concat([d.update(datos.subarray(0, datos.length - 16)), d.final()]);
  assert.equal(claro[claro.length - 1], 2, 'falta el delimitador final');
  return claro.subarray(0, -1).toString('utf8');
}

let servidor;
after(() => servidor?.close());

test('Web Push: el aviso llega cifrado, se puede abrir y va firmado por nosotros', async () => {
  // Un «servicio de avisos» falso, como el de Apple o Google.
  const recibido = await new Promise((listo) => {
    servidor = createServer((req, res) => {
      const partes = [];
      req.on('data', (c) => partes.push(c));
      req.on('end', () => {
        res.writeHead(201).end();
        listo({ headers: req.headers, cuerpo: Buffer.concat(partes) });
      });
    }).listen(0, '127.0.0.1', async () => {
      const ua = createECDH('prime256v1');
      ua.generateKeys();
      const secreto = Buffer.from('secreto-de-16-by');
      servidor.ua = ua;
      servidor.secreto = secreto;
      // Una llave VAPID de prueba (la real vive solo en Vercel).
      const vapid = createECDH('prime256v1');
      vapid.generateKeys();
      servidor.vapidPub = vapid.getPublicKey().toString('base64url');
      const llave = A.llaveVapid(vapid.getPrivateKey().toString('base64url'), servidor.vapidPub);
      const endpoint = `http://127.0.0.1:${servidor.address().port}/push/abc`;
      // enviarWeb firma con la pública oficial: se usa firmaVapid con la de prueba.
      const aviso = { titulo: 'Mañana coordinas tú ✨', cuerpo: 'Prueba', ruta: '/sesiones', etiqueta: 't' };
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: A.firmaVapid(endpoint, llave, servidor.vapidPub),
          'Content-Encoding': 'aes128gcm',
          TTL: '60',
        },
        body: Uint8Array.from(A.cifrarWebPush(JSON.stringify(aviso), { p256dh: ua.getPublicKey().toString('base64url'), auth: secreto.toString('base64url') })),
      });
    });
  });

  assert.equal(recibido.headers['content-encoding'], 'aes128gcm');
  const aviso = JSON.parse(descifrar(recibido.cuerpo, servidor.ua, servidor.secreto));
  assert.equal(aviso.titulo, 'Mañana coordinas tú ✨');

  // La firma: «vapid t=<jwt>, k=<pública>», verificable con la pública.
  const m = recibido.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(m, 'cabecera VAPID con otro formato');
  assert.equal(m[2], servidor.vapidPub);
  const [h, p, f] = m[1].split('.');
  const pub = Buffer.from(m[2], 'base64url');
  const llavePub = createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') },
    format: 'jwk',
  });
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: llavePub, dsaEncoding: 'ieee-p1363' }, Buffer.from(f, 'base64url')));
  const carga = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(carga.aud, `http://127.0.0.1:${servidor.address().port}`);
  assert.match(carga.sub, /^https:\/\//);
  assert.ok(carga.exp > Date.now() / 1000 && carga.exp <= Date.now() / 1000 + 24 * 3600);
});

test('Web Push: el cifrado coincide con el ejemplo oficial (RFC 8291, apéndice A)', () => {
  const e = createECDH('prime256v1');
  e.setPrivateKey(Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'));
  const out = A.cifrarWebPush(
    'When I grow up, I want to be a watermelon',
    { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'),
    e,
  );
  assert.equal(
    out.toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  );
});
