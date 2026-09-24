// Comprueba que Google acepta el ayudante de ingreso de cada dominio de
// src/lib/authHosts.json, SIN tocar nada. Corre dentro de `npm run build`.
//
// Por qué existe: el 2026-08-28 se publicó un dominio en esa lista sin haberlo
// registrado antes en Google Cloud. Google respondió `redirect_uri_mismatch` y
// nadie pudo entrar, en ningún celular ni computador. Con esta comprobación ese
// error se queda en un build fallido de Vercel y no llega a producción.
//
// Cómo comprueba: le pide a Firebase la dirección de ingreso de Google para el
// ayudante de ese dominio (lo mismo que hace la app al tocar "Ingresar") y mira
// a dónde manda Google: a la pantalla de su cuenta (bien) o a su página de error.
//
// Uso a mano:  npm run check:auth

import { readFile } from 'node:fs/promises';

// La misma de src/lib/firebase.ts. No es secreta: viaja en la app.
const API_KEY = 'AIzaSyB-KQMYvpKun5oxQhqTSyF-ElhJxAp-eGQ';

const hosts = JSON.parse(
  await readFile(new URL('../src/lib/authHosts.json', import.meta.url), 'utf8'),
);

if (!Array.isArray(hosts) || hosts.some((h) => typeof h !== 'string')) {
  console.error('✗ src/lib/authHosts.json debe ser una lista de dominios, p. ej. ["coordinacion-gemb.vercel.app"].');
  process.exit(1);
}
if (hosts.length === 0) {
  console.log('Ingreso con Google: sin dominios propios (se usa el de Firebase). Nada que comprobar.');
  process.exit(0);
}

let fallos = 0;
for (const host of hosts) {
  const handler = `https://${host}/__/auth/handler`;
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'google.com', continueUri: handler }),
      },
    );
    const { authUri, error } = await r.json();
    if (!authUri) throw new Error(error?.message || `Firebase respondió ${r.status}`);

    const g = await fetch(authUri, { redirect: 'manual' });
    const destino = g.headers.get('location') || '';
    if (destino.includes('/signin/oauth/error')) {
      // Google explica el error en base64 dentro de `authError`.
      const detalle = Buffer.from(
        new URL(destino).searchParams.get('authError') || '',
        'base64',
      ).toString('latin1');
      const motivo = /redirect_uri_mismatch/.test(detalle)
        ? 'redirect_uri_mismatch: el ayudante NO está registrado en Google Cloud'
        : 'Google rechaza el ingreso';
      console.error(`✗ ${host}: ${motivo}.`);
      fallos++;
    } else if (g.status >= 300 && g.status < 400 && destino.startsWith('https://accounts.google.com/')) {
      console.log(`✓ ${host}: Google acepta ${handler}`);
    } else {
      throw new Error(`respuesta inesperada de Google (${g.status})`);
    }
  } catch (e) {
    console.error(`✗ ${host}: no se pudo comprobar (${e.message}).`);
    fallos++;
  }
}

if (fallos > 0) {
  console.error(
    '\nNo se publica: con un dominio que Google no acepta, NADIE podría entrar.\n' +
      'Registra el ayudante en Google Cloud (README, paso 4b) o quita el dominio de\n' +
      'src/lib/authHosts.json.',
  );
  process.exit(1);
}
