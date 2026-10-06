// Pruebas de las reglas de seguridad de Firestore (firestore.rules).
//
// Corren contra el emulador local, nunca contra la base real:
//   npm run test:reglas
//
// Cada prueba hace lo que haría una persona concreta (coordinadora,
// administradora, alguien recién llegado…) y comprueba si Firestore lo deja
// pasar o lo bloquea. Lo más importante es la parte de varias personas a la
// vez: que marcar o quitar dos veces a la misma persona no descuadre el
// contador de presentes.

import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

const HORA = 3_600_000;
const DIA = 24 * HORA;
const SUPER = 'fundacionsocial@gimnasioemocionalmb.com';

/** Mediodía de Bogotá (así guarda la app las fechas) de hoy + `dias`. */
function mediodiaBogota(dias = 0) {
  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return Timestamp.fromMillis(Date.parse(`${hoy}T12:00:00-05:00`) + dias * DIA);
}

let env;

/** Token de alguien que entró con Google. */
const google = (email, extra = {}) => ({
  email,
  email_verified: true,
  firebase: { sign_in_provider: 'google.com' },
  ...extra,
});

const como = {
  super: () => env.authenticatedContext('super', google(SUPER)).firestore(),
  admin: () => env.authenticatedContext('admin', google('admin@x.com')).firestore(),
  coord: () => env.authenticatedContext('coord', google('coord@x.com')).firestore(),
  coord2: () => env.authenticatedContext('coord2', google('coord2@x.com')).firestore(),
  inactiva: () => env.authenticatedContext('inactiva', google('inactiva@x.com')).firestore(),
  pendiente: () => env.authenticatedContext('pendiente', google('pendiente@x.com')).firestore(),
};

const asistencia = (sessionId, memberId, extra = {}) => ({
  memberId,
  fullName: `Persona ${memberId}`,
  status: 'present',
  checkedInAt: Timestamp.now(),
  checkedInBy: 'coord',
  checkedInByName: 'Coordinadora',
  sessionId,
  sessionType: 'reduccion_ego',
  modality: 'virtual',
  sessionDate: mediodiaBogota(0),
  ...extra,
});

const sesion = (extra = {}) => ({
  type: 'reduccion_ego',
  modality: 'virtual',
  date: mediodiaBogota(0),
  status: 'open',
  createdBy: 'coord',
  createdByName: 'Coordinadora',
  createdAt: Timestamp.now(),
  presentCount: 0,
  coordinator: '',
  ...extra,
});

/** Lee sin reglas (como lo vería la consola de Firebase). */
async function leer(ruta) {
  let data;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const s = await getDoc(doc(ctx.firestore(), ruta));
    data = s.exists() ? s.data() : null;
  });
  return data;
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-gemb-reglas',
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const usuario = (email, role, active = true) => ({
      email,
      displayName: email,
      photoURL: '',
      role,
      active,
    });
    await setDoc(doc(db, 'users/super'), usuario(SUPER, 'super_admin'));
    await setDoc(doc(db, 'users/admin'), usuario('admin@x.com', 'admin'));
    await setDoc(doc(db, 'users/coord'), usuario('coord@x.com', 'coordinador'));
    await setDoc(doc(db, 'users/coord2'), usuario('coord2@x.com', 'coordinador'));
    await setDoc(doc(db, 'users/inactiva'), usuario('inactiva@x.com', 'admin', false));
    await setDoc(doc(db, 'users/pendiente'), usuario('pendiente@x.com', 'pending'));

    await setDoc(doc(db, 'sessions/hoy'), sesion());
    await setDoc(doc(db, 'sessions/agendada'), sesion({ date: mediodiaBogota(7) }));
    await setDoc(doc(db, 'sessions/manana'), sesion({ date: mediodiaBogota(1) }));
    await setDoc(doc(db, 'sessions/vieja'), sesion({ date: mediodiaBogota(-10) }));
    await setDoc(doc(db, 'sessions/anteayer'), sesion({ date: mediodiaBogota(-2) }));
    await setDoc(doc(db, 'sessions/cerrada'), sesion({ status: 'closed' }));

    await setDoc(doc(db, 'members/ana'), { fullName: 'Ana', searchName: 'ana', active: true });
    await setDoc(doc(db, 'invites/nueva@x.com'), { role: 'admin', email: 'nueva@x.com' });
  });
});

/* ------------------------------------------------------------------ */

describe('Marcar asistencia: varias coordinadoras a la vez', () => {
  /** Lo que hace la app al marcar: asistencia + contador en un solo lote. */
  const marcar = (db, sessionId, memberId) => {
    const b = writeBatch(db);
    b.set(doc(db, `sessions/${sessionId}/attendance/${memberId}`), asistencia(sessionId, memberId));
    b.update(doc(db, `sessions/${sessionId}`), { presentCount: increment(1) });
    return b.commit();
  };
  const quitar = (db, sessionId, memberId) => {
    const b = writeBatch(db);
    b.delete(doc(db, `sessions/${sessionId}/attendance/${memberId}`));
    b.update(doc(db, `sessions/${sessionId}`), { presentCount: increment(-1) });
    return b.commit();
  };

  test('una coordinadora marca a alguien en la sesión de hoy', async () => {
    await assertSucceeds(marcar(como.coord(), 'hoy', 'ana'));
    assert.equal((await leer('sessions/hoy')).presentCount, 1);
  });

  test('si otra coordinadora vuelve a marcar a la misma persona, se rechaza TODO el lote y el contador no se infla', async () => {
    await assertSucceeds(marcar(como.coord(), 'hoy', 'ana'));
    const llegada = (await leer('sessions/hoy/attendance/ana')).checkedInAt;
    await assertFails(marcar(como.coord2(), 'hoy', 'ana'));
    assert.equal((await leer('sessions/hoy')).presentCount, 1, 'el contador sigue en 1');
    assert.deepEqual(
      (await leer('sessions/hoy/attendance/ana')).checkedInAt,
      llegada,
      'se conserva la hora de llegada original',
    );
  });

  test('también una administradora: re-marcar a quien ya está se rechaza', async () => {
    await assertSucceeds(marcar(como.coord(), 'hoy', 'ana'));
    await assertFails(marcar(como.admin(), 'hoy', 'ana'));
    assert.equal((await leer('sessions/hoy')).presentCount, 1);
  });

  test('si dos coordinadoras quitan a la misma persona, solo resta una vez', async () => {
    await assertSucceeds(marcar(como.coord(), 'hoy', 'ana'));
    await assertSucceeds(quitar(como.coord(), 'hoy', 'ana'));
    await assertFails(quitar(como.coord2(), 'hoy', 'ana'));
    assert.equal((await leer('sessions/hoy')).presentCount, 0, 'nunca queda en -1');
  });

  test('corregir el nombre de una asistencia sí se permite (poner nombre a "Por identificar")', async () => {
    await assertSucceeds(marcar(como.coord(), 'hoy', 'ana'));
    await assertSucceeds(
      updateDoc(doc(como.coord(), 'sessions/hoy/attendance/ana'), { fullName: 'Ana Pérez' }),
    );
  });

  test('pero no reescribir la hora de llegada ni quién marcó', async () => {
    await assertSucceeds(marcar(como.coord(), 'hoy', 'ana'));
    await assertFails(
      updateDoc(doc(como.coord(), 'sessions/hoy/attendance/ana'), { checkedInAt: Timestamp.now() }),
    );
  });

  test('la asistencia tiene que ser de esa persona y de esa sesión', async () => {
    await assertFails(
      setDoc(doc(como.coord(), 'sessions/hoy/attendance/ana'), asistencia('hoy', 'otra')),
    );
    await assertFails(
      setDoc(doc(como.coord(), 'sessions/hoy/attendance/ana'), asistencia('otra-sesion', 'ana')),
    );
  });
});

describe('Marcar asistencia: sesiones de otro día o cerradas', () => {
  const marcarSolo = (db, s) =>
    setDoc(doc(db, `sessions/${s}/attendance/ana`), asistencia(s, 'ana'));

  test('una coordinadora NO puede marcar en una sesión agendada para la otra semana', async () => {
    await assertFails(marcarSolo(como.coord(), 'agendada'));
  });
  test('ni en la de mañana', async () => {
    await assertFails(marcarSolo(como.coord(), 'manana'));
  });
  test('ni en una abierta de hace 10 días', async () => {
    await assertFails(marcarSolo(como.coord(), 'vieja'));
  });
  test('sí en una de anteayer que sigue abierta (se completa la lista después)', async () => {
    await assertSucceeds(marcarSolo(como.coord(), 'anteayer'));
  });
  test('ni en una sesión cerrada', async () => {
    await assertFails(marcarSolo(como.coord(), 'cerrada'));
  });
  test('la administradora sí puede corregir cualquiera de ellas', async () => {
    for (const s of ['agendada', 'vieja', 'cerrada']) {
      await assertSucceeds(marcarSolo(como.admin(), s));
    }
  });
  test('una administradora sin acceso (desactivada) no puede marcar', async () => {
    await assertFails(marcarSolo(como.inactiva(), 'hoy'));
  });
  test('alguien pendiente de aprobación no puede marcar', async () => {
    await assertFails(marcarSolo(como.pendiente(), 'hoy'));
  });
});

describe('Sesiones', () => {
  test('una coordinadora crea la sesión de hoy', async () => {
    await assertSucceeds(setDoc(doc(como.coord(), 'sessions/nueva'), sesion()));
  });
  test('no puede crearla ya cerrada ni con presentes inventados', async () => {
    await assertFails(setDoc(doc(como.coord(), 'sessions/n1'), sesion({ status: 'closed' })));
    await assertFails(setDoc(doc(como.coord(), 'sessions/n2'), sesion({ presentCount: 9 })));
    await assertFails(setDoc(doc(como.coord(), 'sessions/n3'), sesion({ type: 'otra' })));
  });
  test('crear dos veces la misma sesión (mismo id) no pisa la primera', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      updateDoc(doc(ctx.firestore(), 'sessions/hoy'), { presentCount: 12 }),
    );
    await assertFails(setDoc(doc(como.coord(), 'sessions/hoy'), sesion({ createdBy: 'coord2' })));
    await assertFails(setDoc(doc(como.admin(), 'sessions/hoy'), sesion({ createdBy: 'admin' })));
    assert.equal((await leer('sessions/hoy')).presentCount, 12);
  });
  test('una coordinadora finaliza, pero no reabre', async () => {
    await assertSucceeds(updateDoc(doc(como.coord(), 'sessions/hoy'), { status: 'closed' }));
    await assertFails(updateDoc(doc(como.coord(), 'sessions/hoy'), { status: 'open' }));
    await assertSucceeds(updateDoc(doc(como.admin(), 'sessions/hoy'), { status: 'open' }));
  });
  test('una coordinadora asigna quién coordina mientras está abierta', async () => {
    await assertSucceeds(updateDoc(doc(como.coord(), 'sessions/hoy'), { coordinator: 'Tatiana' }));
    await assertFails(updateDoc(doc(como.coord(), 'sessions/cerrada'), { coordinator: 'Tatiana' }));
  });
  test('solo la administración borra sesiones', async () => {
    await assertFails(deleteDoc(doc(como.coord(), 'sessions/hoy')));
    await assertSucceeds(deleteDoc(doc(como.admin(), 'sessions/hoy')));
  });
});

describe('Personas', () => {
  test('una coordinadora agrega a alguien en plena reunión solo como "por revisar"', async () => {
    await assertSucceeds(
      setDoc(doc(como.coord(), 'members/m1'), { fullName: 'Rous', pendingReview: true, active: true }),
    );
    await assertFails(
      setDoc(doc(como.coord(), 'members/m2'), { fullName: 'Rous', pendingReview: false, active: true }),
    );
  });
  test('una coordinadora no puede aprobar fichas', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'members/m1'), { fullName: 'Rous', pendingReview: true }),
    );
    await assertFails(updateDoc(doc(como.coord(), 'members/m1'), { pendingReview: false }));
    await assertSucceeds(updateDoc(doc(como.admin(), 'members/m1'), { pendingReview: false }));
  });
});

describe('Ingreso, usuarios e invitaciones', () => {
  test('cada quien lee solo SU invitación; la lista completa es de la administración', async () => {
    const nueva = env.authenticatedContext('u-nueva', google('Nueva@X.com')).firestore();
    await assertSucceeds(getDoc(doc(nueva, 'invites/nueva@x.com')));
    await assertFails(getDoc(doc(como.pendiente(), 'invites/nueva@x.com')));
    await assertFails(getDocs(collection(como.pendiente(), 'invites')));
    await assertSucceeds(getDocs(collection(como.admin(), 'invites')));
  });

  test('con invitación se entra con el rol invitado (aunque el correo traiga mayúsculas)', async () => {
    const nueva = env.authenticatedContext('u-nueva', google('Nueva@X.com')).firestore();
    await assertSucceeds(
      setDoc(doc(nueva, 'users/u-nueva'), { email: 'Nueva@X.com', role: 'admin', active: true }),
    );
  });

  test('sin correo verificado o sin Google, no se toma el rol de la invitación', async () => {
    const sinVerificar = env
      .authenticatedContext('u1', google('nueva@x.com', { email_verified: false }))
      .firestore();
    await assertFails(
      setDoc(doc(sinVerificar, 'users/u1'), { email: 'nueva@x.com', role: 'admin', active: true }),
    );
    const conClave = env
      .authenticatedContext('u2', {
        email: 'nueva@x.com',
        email_verified: true,
        firebase: { sign_in_provider: 'password' },
      })
      .firestore();
    await assertFails(
      setDoc(doc(conClave, 'users/u2'), { email: 'nueva@x.com', role: 'admin', active: true }),
    );
  });

  test('nadie se crea como super administrador con un correo que no es el suyo', async () => {
    const intruso = env.authenticatedContext('u3', google('intruso@x.com')).firestore();
    await assertFails(
      setDoc(doc(intruso, 'users/u3'), { email: SUPER, role: 'super_admin', active: true }),
    );
  });

  test('la invitada borra su invitación ya usada; nadie más puede', async () => {
    const nueva = env.authenticatedContext('u-nueva', google('nueva@x.com')).firestore();
    await assertFails(deleteDoc(doc(como.pendiente(), 'invites/nueva@x.com')));
    await assertSucceeds(
      setDoc(doc(nueva, 'users/u-nueva'), { email: 'nueva@x.com', role: 'admin', active: true }),
    );
    await assertSucceeds(deleteDoc(doc(nueva, 'invites/nueva@x.com')));
  });

  test('una administradora desactivada ya no lee la lista de usuarios', async () => {
    await assertFails(getDoc(doc(como.inactiva(), 'users/coord')));
    await assertSucceeds(getDoc(doc(como.admin(), 'users/coord')));
    await assertSucceeds(getDoc(doc(como.inactiva(), 'users/inactiva')), 'su propio documento sí');
  });

  test('una administradora no puede ascender a nadie a administradora', async () => {
    await assertFails(updateDoc(doc(como.admin(), 'users/coord'), { role: 'admin' }));
    await assertSucceeds(updateDoc(doc(como.super(), 'users/coord'), { role: 'admin' }));
  });
});
