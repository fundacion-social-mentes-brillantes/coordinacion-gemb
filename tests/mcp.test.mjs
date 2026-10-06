// El servidor de Claude (MCP) de punta a punta, contra el emulador local de
// Firebase (nunca la base real):
//
//   npm run test:mcp
//
// Usa el MISMO archivo que se despliega en Vercel (api/mcp.js). Con las
// variables de los emuladores puestas (las pone `firebase emulators:exec`),
// ese archivo habla con ellos en vez de con la base real.
//
// Comprueba lo que la auditoría encontró roto: confirmar dos veces el mismo
// borrador no duplica nada, el contador de presentes cuadra aunque se marque
// a la vez, no se marca en reuniones futuras, aprobar corrige el nombre en
// todo el historial, y una llave vencida responde 401.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const FS = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!FS || !AUTH) {
  throw new Error('Corre esto con "npm run test:mcp": hacen falta los emuladores.');
}
const PROYECTO = process.env.GCLOUD_PROJECT || 'demo-gemb';
process.env.GEMB_PROJECT_ID = PROYECTO;

const DOCS = `http://${FS}/v1/projects/${PROYECTO}/databases/(default)/documents`;
const { default: handler } = await import('../api/mcp.js');

/* ------------------------------------------------------------------ */
/* Ayudas                                                              */
/* ------------------------------------------------------------------ */

/** "2026-10-06" en Bogotá, desplazado `dias`. */
function diaBogota(dias = 0) {
  const d = new Date(Date.now() + dias * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
const mediodia = (dia) => new Date(`${dia}T12:00:00-05:00`).toISOString();

function valorRest(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(valorRest) } };
  if (v && v.ts) return { timestampValue: v.ts };
  throw new Error('tipo no soportado');
}
function deRest(f = {}) {
  const o = {};
  for (const [k, v] of Object.entries(f)) {
    if ('stringValue' in v) o[k] = v.stringValue;
    else if ('integerValue' in v) o[k] = Number(v.integerValue);
    else if ('booleanValue' in v) o[k] = v.booleanValue;
    else if ('timestampValue' in v) o[k] = v.timestampValue;
    else if ('arrayValue' in v) o[k] = (v.arrayValue.values ?? []).map((x) => x.stringValue);
    else o[k] = null;
  }
  return o;
}

/** Escribe saltándose las reglas (como la consola de Firebase). */
async function sembrar(ruta, datos) {
  const fields = {};
  for (const [k, v] of Object.entries(datos)) fields[k] = valorRest(v);
  const r = await fetch(`${DOCS}/${ruta}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  assert.ok(r.ok, `sembrar ${ruta}: HTTP ${r.status}`);
}
async function leer(ruta) {
  const r = await fetch(`${DOCS}/${ruta}`, { headers: { Authorization: 'Bearer owner' } });
  if (r.status === 404) return null;
  return deRest((await r.json()).fields);
}
async function listar(ruta) {
  const r = await fetch(`${DOCS}/${ruta}?pageSize=300`, {
    headers: { Authorization: 'Bearer owner' },
  });
  return ((await r.json()).documents ?? []).map((d) => ({
    id: d.name.split('/').pop(),
    ...deRest(d.fields),
  }));
}

async function cuenta(email) {
  const r = await fetch(
    `http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'clave-de-prueba', returnSecureToken: true }),
    },
  );
  const d = await r.json();
  assert.ok(d.refreshToken, `no se creó la cuenta ${email}`);
  return { uid: d.localId, llave: d.refreshToken };
}

/** Llama al servidor como lo hace Claude. */
async function llamar(llave, nombre, args = {}, extra = {}) {
  let estado = 0;
  let cuerpo;
  const cabeceras = {};
  const res = {
    status(n) {
      estado = n;
      return res;
    },
    setHeader(k, v) {
      cabeceras[k.toLowerCase()] = v;
    },
    json(b) {
      cuerpo = b;
    },
    end() {},
  };
  await handler(
    {
      method: 'POST',
      url: extra.url ?? '/api/mcp',
      headers: llave ? { authorization: `Bearer ${llave}` } : {},
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: nombre, arguments: args },
      },
    },
    res,
  );
  const texto = cuerpo?.result?.content?.[0]?.text ?? cuerpo?.error?.message ?? '';
  return { estado, cabeceras, texto, error: cuerpo?.result?.isError === true };
}

const idDe = (texto) => {
  const m = texto.match(/confirmacion_id: (\S+)/);
  assert.ok(m, `sin confirmacion_id en:\n${texto}`);
  return m[1];
};

async function preparaYConfirma(llave, herramienta, args) {
  const p = await llamar(llave, herramienta, args);
  assert.equal(p.error, false, p.texto);
  const confirmacion_id = idDe(p.texto);
  const r = await llamar(llave, 'confirmar_operacion', { confirmacion_id });
  return { ...r, confirmacion_id };
}

/* ------------------------------------------------------------------ */
/* Datos                                                               */
/* ------------------------------------------------------------------ */

const HOY = diaBogota(0);
const MANANA = diaBogota(1);
const SESION = `reduccion_ego-${HOY}`;
const FUTURA = `reduccion_ego-${MANANA}`;
let admin;
let coord;

before(async () => {
  admin = await cuenta(`admin-${Date.now()}@prueba.test`);
  coord = await cuenta(`coord-${Date.now()}@prueba.test`);
});

beforeEach(async () => {
  await fetch(`http://${FS}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  await sembrar(`users/${admin.uid}`, {
    email: 'admin@prueba.test',
    displayName: 'Admin Prueba',
    role: 'admin',
    active: true,
  });
  await sembrar(`users/${coord.uid}`, {
    email: 'coord@prueba.test',
    displayName: 'Coordinadora Prueba',
    role: 'coordinador',
    active: true,
  });
  for (const [id, dia] of [
    [SESION, HOY],
    [FUTURA, MANANA],
  ]) {
    await sembrar(`sessions/${id}`, {
      type: 'reduccion_ego',
      modality: 'virtual',
      date: { ts: mediodia(dia) },
      status: 'open',
      createdBy: admin.uid,
      createdByName: 'Admin Prueba',
      presentCount: 0,
      coordinator: '',
    });
  }
  const personas = [
    ['m_rous', 'Rous', []],
    ['m_rosalba', 'Rosalba Martínez', ['Chava']],
    ['m_ana', 'Ana Gómez', []],
    ['m_luis', 'Luis Ortega', []],
    ['m_marta', 'Marta Ruiz', []],
    ['m_pedro', 'Pedro Díaz', []],
  ];
  for (const [id, nombre, aliases] of personas) {
    await sembrar(`members/${id}`, {
      fullName: nombre,
      firstName: nombre.split(' ')[0],
      lastName: nombre.split(' ').slice(1).join(' '),
      searchName: nombre
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase(),
      aliases,
      active: true,
      pendingReview: false,
      pendingIdentify: false,
    });
  }
});

/* ------------------------------------------------------------------ */
/* Pruebas                                                             */
/* ------------------------------------------------------------------ */

test('marcar y confirmar DOS veces el mismo borrador cuenta una sola vez', async () => {
  const r1 = await preparaYConfirma(admin.llave, 'preparar_marcar_presente', {
    reunion_id: SESION,
    persona_id: 'm_ana',
  });
  assert.equal(r1.error, false, r1.texto);
  assert.match(r1.texto, /Ahora hay 1 presentes/);

  const r2 = await llamar(admin.llave, 'confirmar_operacion', {
    confirmacion_id: r1.confirmacion_id,
  });
  assert.match(r2.texto, /ya figuraba como presente/);

  assert.equal((await leer(`sessions/${SESION}`)).presentCount, 1);
  assert.equal((await listar(`sessions/${SESION}/attendance`)).length, 1);
});

test('cinco marcas confirmadas a la vez: el contador termina exacto', async () => {
  const ids = ['m_ana', 'm_luis', 'm_marta', 'm_pedro', 'm_rosalba'];
  const borradores = [];
  for (const persona_id of ids) {
    const p = await llamar(admin.llave, 'preparar_marcar_presente', {
      reunion_id: SESION,
      persona_id,
    });
    borradores.push(idDe(p.texto));
  }
  const res = await Promise.all(
    borradores.map((confirmacion_id) =>
      llamar(admin.llave, 'confirmar_operacion', { confirmacion_id }),
    ),
  );
  for (const r of res) assert.equal(r.error, false, r.texto);
  assert.equal((await leer(`sessions/${SESION}`)).presentCount, 5);
});

test('quitar dos veces no resta dos', async () => {
  await preparaYConfirma(admin.llave, 'preparar_marcar_presente', {
    reunion_id: SESION,
    persona_id: 'm_luis',
  });
  const q = await preparaYConfirma(admin.llave, 'preparar_quitar_presente', {
    reunion_id: SESION,
    persona_id: 'm_luis',
  });
  assert.equal(q.error, false, q.texto);
  const otra = await llamar(admin.llave, 'confirmar_operacion', {
    confirmacion_id: q.confirmacion_id,
  });
  assert.match(otra.texto, /ya no figuraba/);
  assert.equal((await leer(`sessions/${SESION}`)).presentCount, 0);
});

test('agregar a alguien sin ficha dos veces deja UNA ficha y una asistencia', async () => {
  const r = await preparaYConfirma(admin.llave, 'preparar_agregar_participante', {
    reunion_id: SESION,
    nombre: 'kata blum',
  });
  assert.equal(r.error, false, r.texto);
  const otra = await llamar(admin.llave, 'confirmar_operacion', {
    confirmacion_id: r.confirmacion_id,
  });
  assert.match(otra.texto, /ya se había agregado/);

  const nuevas = (await listar('members')).filter((m) => m.searchName === 'kata blum');
  assert.equal(nuevas.length, 1);
  assert.equal(nuevas[0].pendingReview, true);
  assert.equal(nuevas[0].fullName, 'Kata Blum');
  assert.equal((await leer(`sessions/${SESION}`)).presentCount, 1);
});

test('agregar "Rous Martínez" avisa de la ficha "Rous" y de "Rosalba Martínez"', async () => {
  const p = await llamar(admin.llave, 'preparar_agregar_participante', {
    reunion_id: SESION,
    nombre: 'Rous Martínez',
  });
  assert.match(p.texto, /nombre parecido/);
  assert.match(p.texto, /Rous {2}id: m_rous/);
});

test('buscar_persona encuentra por alias y con errores de tipeo', async () => {
  const alias = await llamar(admin.llave, 'buscar_persona', { nombre: 'chava' });
  assert.match(alias.texto, /Rosalba Martínez/);
  const tipeo = await llamar(admin.llave, 'buscar_persona', { nombre: 'Rosalva Martines' });
  assert.match(tipeo.texto, /Rosalba Martínez/);
});

test('no deja marcar en una reunión que todavía no ocurre', async () => {
  const p = await llamar(admin.llave, 'preparar_marcar_presente', {
    reunion_id: FUTURA,
    persona_id: 'm_ana',
  });
  assert.equal(p.error, true);
  assert.match(p.texto, /todavía no ha ocurrido/);
});

test('crear reunión: rechaza la del mismo día y no duplica al confirmar dos veces', async () => {
  const dup = await llamar(admin.llave, 'preparar_crear_reunion', {
    tipo: 'ego',
    modalidad: 'virtual',
    fecha: HOY,
  });
  assert.equal(dup.error, true);
  assert.match(dup.texto, new RegExp(`Ya existe.*\\n.*${SESION}`));

  const pasado = diaBogota(-2);
  const r = await preparaYConfirma(admin.llave, 'preparar_crear_reunion', {
    tipo: 'pasos',
    modalidad: 'presencial',
    fecha: pasado,
  });
  assert.equal(r.error, false, r.texto);
  assert.match(r.texto, /ciérrala/);
  const otra = await llamar(admin.llave, 'confirmar_operacion', {
    confirmacion_id: r.confirmacion_id,
  });
  assert.match(otra.texto, /ya estaba creada/);

  const creada = await leer(`sessions/entrega_pasos-${pasado}`);
  assert.ok(creada, 'debe usar el mismo id que la app');
  assert.equal(
    new Date(creada.date).toISOString(),
    mediodia(pasado),
    'mediodía de Bogotá, como la app',
  );
});

test('aprobar corrige el nombre en la ficha Y en su historial', async () => {
  const r = await preparaYConfirma(admin.llave, 'preparar_agregar_participante', {
    reunion_id: SESION,
    nombre: 'sandra',
  });
  const id = r.texto.match(/id: (\S+)/)[1];
  const a = await preparaYConfirma(admin.llave, 'preparar_aprobar_persona', {
    persona_id: id,
    nombre: 'sandra milena ruiz',
  });
  assert.equal(a.error, false, a.texto);
  const ficha = await leer(`members/${id}`);
  assert.equal(ficha.fullName, 'Sandra Milena Ruiz');
  assert.equal(ficha.firstName, 'Sandra');
  assert.equal(ficha.lastName, 'Milena Ruiz');
  assert.equal(ficha.pendingReview, false);
  assert.equal((await leer(`sessions/${SESION}/attendance/${id}`)).fullName, 'Sandra Milena Ruiz');
});

test('aprobar una ficha que borraron mientras tanto NO la resucita', async () => {
  const r = await preparaYConfirma(admin.llave, 'preparar_agregar_participante', {
    reunion_id: SESION,
    nombre: 'miriam sabogal',
  });
  const id = r.texto.match(/id: (\S+)/)[1];
  const p = await llamar(admin.llave, 'preparar_aprobar_persona', { persona_id: id });
  await fetch(`${DOCS}/members/${id}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer owner' },
  });
  const c = await llamar(admin.llave, 'confirmar_operacion', { confirmacion_id: idDe(p.texto) });
  assert.match(c.texto, /ya no existe/);
  assert.equal(await leer(`members/${id}`), null);
});

test('cerrar una reunión que borraron mientras tanto no la vuelve a crear', async () => {
  const p = await llamar(admin.llave, 'preparar_cerrar_reunion', { reunion_id: SESION });
  await fetch(`${DOCS}/sessions/${SESION}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer owner' },
  });
  const c = await llamar(admin.llave, 'confirmar_operacion', { confirmacion_id: idDe(p.texto) });
  assert.match(c.texto, /ya no existe/);
  assert.equal(await leer(`sessions/${SESION}`), null);
});

test('un confirmacion_id alterado no ejecuta nada', async () => {
  const p = await llamar(admin.llave, 'preparar_marcar_presente', {
    reunion_id: SESION,
    persona_id: 'm_ana',
  });
  const id = idDe(p.texto);
  const [cuerpo, firma] = id.split('.');
  const json = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  json.args.personaId = 'm_luis';
  const alterado = `${Buffer.from(JSON.stringify(json)).toString('base64url')}.${firma}`;
  const c = await llamar(admin.llave, 'confirmar_operacion', { confirmacion_id: alterado });
  assert.equal(c.error, true);
  assert.match(c.texto, /alterado/);
  assert.equal((await listar(`sessions/${SESION}/attendance`)).length, 0);
});

test('la coordinadora solo lee: no puede preparar escrituras', async () => {
  const p = await llamar(coord.llave, 'preparar_marcar_presente', {
    reunion_id: SESION,
    persona_id: 'm_ana',
  });
  assert.equal(p.error, true);
  assert.match(p.texto, /solo para administración/);
  const lista = await llamar(coord.llave, 'asistencia_reunion', { reunion_id: SESION });
  assert.equal(lista.error, false, lista.texto);
});

test('llave inválida: 401 para que Claude ofrezca reconectar', async () => {
  const r = await llamar('esto-no-es-una-llave-valida-de-firebase', 'quien_soy');
  assert.equal(r.estado, 401);
  assert.match(r.cabeceras['www-authenticate'] ?? '', /invalid_token/);
});

test('la llave en la dirección (?k=) ya no se acepta', async () => {
  const r = await llamar(null, 'quien_soy', {}, { url: `/api/mcp?k=${admin.llave}` });
  assert.equal(r.estado, 400);
});

test('reuniones: separa las recientes de las agendadas', async () => {
  const r = await llamar(admin.llave, 'reuniones', { tipo: 'ego' });
  const iReciente = r.texto.indexOf('Recientes:');
  const iAgendada = r.texto.indexOf('Agendadas:');
  assert.ok(iReciente >= 0 && iAgendada > iReciente, r.texto);
  assert.ok(r.texto.indexOf(SESION) < iAgendada);
  assert.ok(r.texto.indexOf(FUTURA) > iAgendada);
});
