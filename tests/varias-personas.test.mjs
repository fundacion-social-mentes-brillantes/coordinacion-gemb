// "Varias personas a la vez": simula a varias coordinadoras, cada una en su
// propio celular, tomando lista en la MISMA reunión al mismo tiempo, contra el
// emulador local de Firebase (nunca la base real):
//
//   npm run test:varias
//
// Cada "celular" es una app de Firebase independiente, con su propia sesión
// de Google (cuentas de prueba del emulador) y su propia conexión. Hacen
// exactamente las mismas escrituras que la app (src/services/attendance.ts y
// sessions.ts) y al final se comprueba que los datos cuadren.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  signInWithCredential,
} from 'firebase/auth';
import {
  Timestamp,
  collection,
  connectFirestoreEmulator,
  disableNetwork,
  doc,
  enableNetwork,
  getDocs,
  getFirestore,
  increment,
  serverTimestamp,
  setDoc,
  setLogLevel,
  writeBatch,
} from 'firebase/firestore';

setLogLevel('silent'); // los rechazos esperados no ensucian la salida

const PROYECTO = 'demo-gemb';
const FS = 'http://127.0.0.1:8080';
const RAIZ = `${FS}/v1/projects/${PROYECTO}/databases/(default)/documents`;
const DIA = 86_400_000;

function hoyBogota() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
const HOY = hoyBogota();
const FECHA_HOY = Timestamp.fromMillis(Date.parse(`${HOY}T12:00:00-05:00`));

/* ------------------------------------------------------------------ */
/* Datos de prueba (escritos como "dueño", saltándose las reglas)       */
/* ------------------------------------------------------------------ */

async function rest(metodo, ruta, cuerpo) {
  const r = await fetch(`${RAIZ}/${ruta}`, {
    method: metodo,
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (!r.ok) throw new Error(`${metodo} ${ruta}: ${r.status} ${await r.text()}`);
  return r.json();
}
const valor = (v) =>
  typeof v === 'string'
    ? { stringValue: v }
    : typeof v === 'boolean'
      ? { booleanValue: v }
      : typeof v === 'number'
        ? { integerValue: String(v) }
        : v instanceof Date
          ? { timestampValue: v.toISOString() }
          : { nullValue: null };
const campos = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, valor(v)]));
const leerTodo = async (ruta) => (await rest('GET', `${ruta}?pageSize=1000`)).documents ?? [];

async function limpiar() {
  await fetch(`${FS}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`, {
    method: 'DELETE',
  });
}

/** 120 personas, con nombres parecidos a propósito (los casos reales). */
const NOMBRES = [
  'Miriam Sabogal', 'Catalina Fernández', 'Jacqueline Torres Ruiz', 'Jacqueline Nieto',
  'Alexandra Ortega', 'Edison López', 'Rosa Tatiana López', 'Edna Vaquero Ruiz',
  'Marcela Gómez Jaramillo', 'Sandra Milena Cuadrado', 'Gloria Sandoval Pico',
  'Blanca Cecilia Reyes', 'Olga Yaneth Reyes', 'Leidy Johana Acosta', 'Valeria López Ortega',
];
for (let i = NOMBRES.length; i < 120; i++) NOMBRES.push(`Persona Prueba ${i}`);

/* ------------------------------------------------------------------ */
/* Celulares: una app de Firebase por coordinadora                      */
/* ------------------------------------------------------------------ */

const celulares = [];

async function celular(nombre, rol) {
  const app = initializeApp({ apiKey: 'demo', projectId: PROYECTO }, `cel-${nombre}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const email = `${nombre}@prueba.gemb`;
  const cred = GoogleAuthProvider.credential(
    JSON.stringify({ sub: `g-${nombre}`, email, email_verified: true }),
  );
  const { user } = await signInWithCredential(auth, cred);
  await rest('PATCH', `users/${user.uid}`, {
    fields: campos({ email, displayName: nombre, photoURL: '', role: rol, active: true }),
  });
  const c = { nombre, app, db, uid: user.uid };
  celulares.push(c);
  return c;
}

/** Lo que hace la app al marcar (services/attendance.ts → markPresent). */
function marcar(c, sesionId, memberId, nombre) {
  const b = writeBatch(c.db);
  b.set(doc(c.db, 'sessions', sesionId, 'attendance', memberId), {
    memberId,
    fullName: nombre,
    status: 'present',
    checkedInAt: Timestamp.now(),
    checkedInBy: c.uid,
    checkedInByName: c.nombre,
    sessionId: sesionId,
    sessionType: 'reduccion_ego',
    modality: 'virtual',
    sessionDate: FECHA_HOY,
  });
  b.update(doc(c.db, 'sessions', sesionId), { presentCount: increment(1) });
  return b.commit();
}
function quitar(c, sesionId, memberId) {
  const b = writeBatch(c.db);
  b.delete(doc(c.db, 'sessions', sesionId, 'attendance', memberId));
  b.update(doc(c.db, 'sessions', sesionId), { presentCount: increment(-1) });
  return b.commit();
}

/** Estado real en el servidor: contador vs. documentos de asistencia. */
async function cuadre(sesionId) {
  const s = await rest('GET', `sessions/${sesionId}`);
  const docs = await leerTodo(`sessions/${sesionId}/attendance`);
  return { contador: Number(s.fields.presentCount.integerValue), reales: docs.length, docs };
}

before(async () => {
  await limpiar();
  for (let i = 0; i < NOMBRES.length; i++) {
    await rest('PATCH', `members/m${i}`, {
      fields: campos({ fullName: NOMBRES[i], searchName: NOMBRES[i].toLowerCase(), active: true }),
    });
  }
});

after(async () => {
  for (const c of celulares) await deleteApp(c.app);
});

/* ------------------------------------------------------------------ */

describe('Varias coordinadoras en la misma reunión', () => {
  const SESION = 'ego-hoy';

  test('6 coordinadoras marcan a 60 personas a la vez, con muchas repetidas: el contador cuadra', async () => {
    await rest('PATCH', `sessions/${SESION}`, {
      fields: {
        ...campos({ type: 'reduccion_ego', modality: 'virtual', status: 'open', createdBy: 'x', presentCount: 0 }),
        date: { timestampValue: FECHA_HOY.toDate().toISOString() },
        createdAt: { timestampValue: new Date().toISOString() },
      },
    });
    const coords = await Promise.all(
      ['ana', 'bea', 'cata', 'dora', 'eva', 'fany'].map((n) => celular(n, 'coordinador')),
    );

    // Cada una marca a un tramo de 30 personas que se solapa con las demás:
    // casi todas las personas las marcan 2 o 3 coordinadoras a la vez.
    const intentos = [];
    coords.forEach((c, k) => {
      for (let i = k * 6; i < k * 6 + 30; i++) {
        const id = `m${i % 60}`;
        intentos.push(marcar(c, SESION, id, NOMBRES[i % 60]).then(() => 'ok', () => 'rechazado'));
      }
    });
    const res = await Promise.all(intentos);
    const { contador, reales, docs } = await cuadre(SESION);

    const ok = res.filter((r) => r === 'ok').length;
    console.log(`    ${intentos.length} intentos de marcar → ${ok} guardados, ${intentos.length - ok} rechazados por repetidos`);
    assert.equal(reales, 60, 'quedan exactamente las 60 personas');
    assert.equal(contador, reales, `el contador (${contador}) cuadra con la lista (${reales})`);
    assert.equal(ok, 60, 'solo la primera marca de cada persona se guarda');
    assert.ok(docs.every((d) => d.fields.status.stringValue === 'present'));
  });

  test('3 coordinadoras quitan a las mismas 10 personas a la vez: resta una sola vez', async () => {
    const [a, b, c] = celulares;
    const intentos = [];
    for (let i = 0; i < 10; i++) {
      for (const cel of [a, b, c]) intentos.push(quitar(cel, SESION, `m${i}`).catch(() => null));
    }
    await Promise.all(intentos);
    const { contador, reales } = await cuadre(SESION);
    assert.equal(reales, 50);
    assert.equal(contador, 50, 'el contador nunca baja de más');
  });

  test('una coordinadora SIN SEÑAL marca a 15 que otra ya marcó; al reconectar nada se infla', async () => {
    const [a, b] = celulares;
    await disableNetwork(b.db);
    // Sin señal: la app NO espera estas promesas (quedan en el teléfono).
    const pendientes = [];
    for (let i = 10; i < 25; i++) pendientes.push(marcar(b, SESION, `m${i}`, NOMBRES[i]).catch(() => 'rechazado'));
    // Mientras tanto, la que tiene señal vuelve a marcar a las que se habían quitado.
    for (let i = 0; i < 10; i++) await marcar(a, SESION, `m${i}`, NOMBRES[i]);
    await enableNetwork(b.db);
    const res = await Promise.all(pendientes);
    const { contador, reales } = await cuadre(SESION);
    assert.equal(res.filter((r) => r === 'rechazado').length, 15, 'las 15 ya estaban: se rechazan al reconectar');
    assert.equal(reales, 60);
    assert.equal(contador, 60);
  });
});

describe('Dos coordinadoras agregan a la MISMA persona nueva a la vez', () => {
  test('queda una sola ficha y una sola asistencia (antes quedaban dos "Rous")', async () => {
    const SESION = 'ego-hoy';
    const [a, b, c] = celulares;
    // Mismo id que arma la app: sesión + nombre normalizado.
    const id = 'p_prueba_rous_mery';
    const agregar = (cel) => {
      const bt = writeBatch(cel.db);
      bt.set(doc(cel.db, 'members', id), {
        fullName: 'Rous Mery',
        searchName: 'rous mery',
        aliases: [],
        active: true,
        pendingReview: true,
        pendingIdentify: false,
        createdAt: serverTimestamp(),
        createdBy: cel.uid,
      });
      bt.set(doc(cel.db, 'sessions', SESION, 'attendance', id), {
        memberId: id,
        fullName: 'Rous Mery',
        status: 'present',
        checkedInAt: Timestamp.now(),
        checkedInBy: cel.uid,
        checkedInByName: cel.nombre,
        sessionId: SESION,
        sessionType: 'reduccion_ego',
        modality: 'virtual',
        sessionDate: FECHA_HOY,
      });
      bt.update(doc(cel.db, 'sessions', SESION), { presentCount: increment(1) });
      return bt.commit().then(() => 'ok', () => 'rechazado');
    };
    const res = await Promise.all([agregar(a), agregar(b), agregar(c)]);
    const rous = (await leerTodo('members')).filter((d) => d.fields.fullName?.stringValue === 'Rous Mery');
    const { contador, reales } = await cuadre(SESION);
    assert.equal(res.filter((r) => r === 'ok').length, 1);
    assert.equal(rous.length, 1, 'una sola ficha');
    assert.equal(contador, reales, 'el contador cuadra');
  });
});

describe('Dos coordinadoras crean la sesión de hoy a la vez', () => {
  test('queda UNA sesión (mismo id por tipo y día) y las listas se juntan', async () => {
    const [a, b] = celulares;
    const id = `entrega_pasos-${HOY}`;
    const crear = (cel) =>
      setDoc(doc(cel.db, 'sessions', id), {
        type: 'entrega_pasos',
        modality: 'presencial',
        date: FECHA_HOY,
        status: 'open',
        createdBy: cel.uid,
        createdByName: cel.nombre,
        createdAt: serverTimestamp(),
        presentCount: 0,
        coordinator: '',
      }).then(() => 'ok', () => 'rechazado');
    const res = await Promise.all([crear(a), crear(b)]);
    assert.equal(res.filter((r) => r === 'ok').length, 1, 'la segunda no pisa a la primera');
    // Las dos marcan en "su" sesión, que es la misma.
    await marcar(a, id, 'm1', NOMBRES[1]);
    await marcar(b, id, 'm2', NOMBRES[2]);
    const pasosHoy = (await leerTodo('sessions')).filter(
      (d) => d.fields.type.stringValue === 'entrega_pasos',
    );
    const { contador, reales } = await cuadre(id);
    assert.equal(pasosHoy.length, 1, 'una sola sesión de Pasos hoy');
    assert.equal(reales, 2);
    assert.equal(contador, 2);
  });
});

describe('Carga: 120 personas en una reunión', () => {
  test('5 coordinadoras marcan a 120 personas en menos de unos segundos y todo cuadra', async () => {
    const SESION = 'ego-grande';
    await rest('PATCH', `sessions/${SESION}`, {
      fields: {
        ...campos({ type: 'reduccion_ego', modality: 'presencial', status: 'open', createdBy: 'x', presentCount: 0 }),
        date: { timestampValue: FECHA_HOY.toDate().toISOString() },
        createdAt: { timestampValue: new Date().toISOString() },
      },
    });
    const t0 = Date.now();
    const intentos = [];
    for (let i = 0; i < 120; i++) {
      const cel = celulares[i % 5];
      intentos.push(marcar(cel, SESION, `m${i}`, NOMBRES[i]));
    }
    await Promise.all(intentos);
    const ms = Date.now() - t0;
    const { contador, reales } = await cuadre(SESION);
    console.log(`    120 marcas en ${ms} ms`);
    assert.equal(reales, 120);
    assert.equal(contador, 120);
  });
});
