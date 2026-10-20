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
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
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
  progra: () => env.authenticatedContext('progra', google('progra@x.com')).firestore(),
  colado: () => env.authenticatedContext('colado', google('colado@x.com')).firestore(),
  anonimo: () => env.unauthenticatedContext().firestore(),
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
    // Coordinadora con permiso de programar el calendario.
    await setDoc(doc(db, 'users/progra'), {
      ...usuario('progra@x.com', 'coordinador'),
      puedeProgramar: true,
    });
    // Alguien pendiente que logró guardarse el permiso (no debe servirle).
    await setDoc(doc(db, 'users/colado'), {
      ...usuario('colado@x.com', 'pending'),
      puedeProgramar: true,
    });
    await setDoc(doc(db, 'programacion/config'), {
      dias: {},
      coordinadoras: ['Tatiana López', 'Marcela Sánchez'],
      desde: '2026-02-03',
      hasta: '2026-12-10',
      semanasVirtuales: 'par',
      grupoWhatsapp: '',
    });
    await setDoc(doc(db, 'programacion_dias/2026-10-13'), { coordinadora: 'Tatiana López' });

    await setDoc(doc(db, 'sessions/hoy'), sesion());
    await setDoc(doc(db, 'sessions/agendada'), sesion({ date: mediodiaBogota(7) }));
    await setDoc(doc(db, 'sessions/manana'), sesion({ date: mediodiaBogota(1) }));
    await setDoc(doc(db, 'sessions/vieja'), sesion({ date: mediodiaBogota(-10) }));
    await setDoc(doc(db, 'sessions/anteayer'), sesion({ date: mediodiaBogota(-2) }));
    await setDoc(doc(db, 'sessions/cerrada'), sesion({ status: 'closed' }));

    await setDoc(doc(db, 'members/ana'), { fullName: 'Ana', searchName: 'ana', active: true });
    await setDoc(doc(db, 'invites/nueva@x.com'), { role: 'admin', email: 'nueva@x.com' });
    await setDoc(doc(db, 'invites/agenda@x.com'), {
      role: 'coordinador',
      email: 'agenda@x.com',
      puedeProgramar: true,
    });
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

/**
 * Como la app: el cambio público y, en el mismo lote, quién lo hizo en
 * programacion_cambios (que solo lee el equipo).
 */
const conFirma = (db, id, uid, escribir) => {
  const b = writeBatch(db);
  escribir(b);
  b.set(doc(db, `programacion_cambios/${id}`), { updatedAt: serverTimestamp(), updatedBy: uid, updatedByName: uid });
  return b.commit();
};

describe('Programación (el antiguo Calendario)', () => {
  const cambio = (extra = {}) => ({ coordinadora: 'Marcela Sánchez', updatedAt: Timestamp.now(), ...extra });
  /** Guardar un día como lo hace la app; `firma` es a nombre de quién va el registro privado. */
  const guardar = (db, dia, firma, extra = {}) =>
    conFirma(db, dia, firma, (b) => b.set(doc(db, `programacion_dias/${dia}`), cambio(extra)));

  test('cualquiera la lee sin iniciar sesión', async () => {
    await assertSucceeds(getDoc(doc(como.anonimo(), 'programacion/config')));
    await assertSucceeds(getDocs(collection(como.anonimo(), 'programacion_dias')));
    await assertSucceeds(getDocs(collection(como.anonimo(), 'programacion_solicitudes')));
  });

  test('sin sesión, o siendo coordinadora sin permiso, no se cambia', async () => {
    await assertFails(guardar(como.anonimo(), '2026-10-15', 'x'));
    await assertFails(guardar(como.coord(), '2026-10-15', 'coord'));
    await assertFails(deleteDoc(doc(como.coord(), 'programacion_dias/2026-10-13')));
  });

  test('la administración y quien tiene el permiso sí la cambian', async () => {
    await assertSucceeds(guardar(como.admin(), '2026-10-15', 'admin'));
    await assertSucceeds(guardar(como.progra(), '2026-10-20', 'progra', { modalidad: 'virtual' }));
    await assertSucceeds(deleteDoc(doc(como.progra(), 'programacion_dias/2026-10-13')));
  });

  test('un pendiente que se guardó el permiso no puede programar', async () => {
    await assertFails(guardar(como.colado(), '2026-10-15', 'colado'));
  });

  test('nadie se da el permiso de programar al crear su cuenta', async () => {
    const nuevo = env.authenticatedContext('u-prog', google('nuevo@x.com')).firestore();
    await assertFails(
      setDoc(doc(nuevo, 'users/u-prog'), {
        email: 'nuevo@x.com',
        displayName: 'Nuevo',
        photoURL: '',
        role: 'pending',
        active: true,
        puedeProgramar: true,
      }),
    );
    await assertSucceeds(
      setDoc(doc(nuevo, 'users/u-prog'), {
        email: 'nuevo@x.com',
        displayName: 'Nuevo',
        photoURL: '',
        role: 'pending',
        active: true,
      }),
    );
  });

  test('se rechazan campos desconocidos, modalidades raras y firmas ajenas', async () => {
    const db = como.admin();
    await assertFails(guardar(db, '2026-10-15', 'admin', { colado: 1 }));
    await assertFails(guardar(db, '2026-10-15', 'admin', { modalidad: 'hibrida' }));
    await assertFails(guardar(db, '2026-10-15', 'otra-persona'), 'firmar a nombre de otra');
    await assertFails(guardar(db, 'no-es-fecha', 'admin'));
  });

  test('quién lo cambió no queda en lo público: va aparte y solo lo lee el equipo', async () => {
    const db = como.admin();
    // En el día público, ni con la firma privada al lado.
    await assertFails(guardar(db, '2026-10-15', 'admin', { updatedBy: 'admin' }));
    await assertFails(guardar(db, '2026-10-15', 'admin', { updatedByName: 'Admin' }));
    // Y sin la firma privada el cambio no pasa (siempre queda quién fue).
    await assertFails(setDoc(doc(db, 'programacion_dias/2026-10-15'), cambio()));
    await assertSucceeds(guardar(db, '2026-10-15', 'admin'));
    const publico = (await getDoc(doc(como.anonimo(), 'programacion_dias/2026-10-15'))).data();
    assert.equal(publico.coordinadora, 'Marcela Sánchez');
    assert.equal('updatedBy' in publico || 'updatedByName' in publico, false);
    // El registro: el equipo sí, sin sesión o pendiente no.
    await assertFails(getDoc(doc(como.anonimo(), 'programacion_cambios/2026-10-15')));
    await assertFails(getDoc(doc(como.pendiente(), 'programacion_cambios/2026-10-15')));
    const firma = (await getDoc(doc(como.coord(), 'programacion_cambios/2026-10-15'))).data();
    assert.equal(firma.updatedBy, 'admin');
    // Nadie lo escribe a nombre de otra, ni sin sesión, ni lo borra.
    const firmar = (dbx, uid) =>
      setDoc(doc(dbx, 'programacion_cambios/2026-10-16'), { updatedAt: serverTimestamp(), updatedBy: uid, updatedByName: uid });
    await assertFails(firmar(como.coord(), 'admin'));
    await assertFails(firmar(como.anonimo(), 'x'));
    await assertFails(deleteDoc(doc(como.admin(), 'programacion_cambios/2026-10-15')));
  });

  test('Apartar sin sesión ya no se usa; quien programa limpia las solicitudes viejas', async () => {
    const pedir = (db, dia, nombre) =>
      setDoc(doc(db, `programacion_solicitudes/${dia}`), {
        nombre,
        estado: 'pendiente',
        createdAt: serverTimestamp(),
      });
    await assertFails(pedir(como.anonimo(), '2026-10-15', 'Marcela Sánchez'));
    await assertFails(pedir(como.coord(), '2026-10-15', 'Marcela Sánchez'));
    await assertFails(deleteDoc(doc(como.coord(), 'programacion_solicitudes/2026-10-15')));
    await assertSucceeds(deleteDoc(doc(como.progra(), 'programacion_solicitudes/2026-10-15')));
  });

  test('la configuración solo la cambia quien programa, con forma válida y sin firma pública', async () => {
    const base = {
      dias: {},
      coordinadoras: ['Tatiana López'],
      desde: '2027-02-02',
      hasta: '2027-12-09',
      semanasVirtuales: 'impar',
      grupoWhatsapp: '',
      updatedAt: Timestamp.now(),
    };
    const poner = (db, uid, datos, ruta = 'programacion/config') =>
      conFirma(db, 'config', uid, (b) => b.set(doc(db, ruta), datos));
    await assertFails(poner(como.coord(), 'coord', base));
    await assertSucceeds(poner(como.progra(), 'progra', base));
    await assertFails(poner(como.admin(), 'admin', { ...base, desde: 'febrero' }));
    await assertFails(poner(como.admin(), 'admin', base, 'programacion/otra'));
    await assertFails(poner(como.admin(), 'admin', { ...base, updatedBy: 'admin' }), 'firma pública');
    await assertFails(setDoc(doc(como.admin(), 'programacion/config'), base), 'sin firma privada');
  });
});

describe('Roles: Coordinador, Coordinador de coordinadores y Administrador', () => {
  const alta = (email, extra = {}) => ({
    email,
    displayName: email,
    photoURL: '',
    role: 'coordinador',
    active: true,
    ...extra,
  });

  test('una administradora da acceso como Coordinador, pero no el permiso de agendar', async () => {
    await assertSucceeds(
      updateDoc(doc(como.admin(), 'users/pendiente'), { role: 'coordinador', active: true }),
    );
    await assertFails(updateDoc(doc(como.admin(), 'users/coord'), { puedeProgramar: true }));
    await assertFails(
      updateDoc(doc(como.admin(), 'users/progra'), { puedeProgramar: false }),
      'tampoco quitárselo',
    );
  });

  test('el principal sí cambia el permiso de agendar', async () => {
    await assertSucceeds(updateDoc(doc(como.super(), 'users/coord'), { puedeProgramar: true }));
    await assertSucceeds(updateDoc(doc(como.super(), 'users/progra'), { puedeProgramar: false }));
  });

  test('solo el principal deja anotado a alguien como Coordinador de coordinadores', async () => {
    const inv = { email: 'x@x.com', role: 'coordinador', puedeProgramar: true };
    await assertFails(setDoc(doc(como.admin(), 'invites/x@x.com'), inv));
    await assertSucceeds(setDoc(doc(como.super(), 'invites/x@x.com'), inv));
    await assertSucceeds(
      setDoc(doc(como.admin(), 'invites/y@x.com'), { email: 'y@x.com', role: 'coordinador' }),
    );
  });

  test('quien está en la entrada directa entra con su rol (y su permiso si lo trae)', async () => {
    const agenda = env.authenticatedContext('u-agenda', google('agenda@x.com')).firestore();
    await assertSucceeds(
      setDoc(doc(agenda, 'users/u-agenda'), alta('agenda@x.com', { puedeProgramar: true })),
    );
  });

  test('sin invitación que lo traiga, nadie entra con el permiso de agendar', async () => {
    const nueva = env.authenticatedContext('u-nueva2', google('nueva@x.com')).firestore();
    await assertFails(
      setDoc(doc(nueva, 'users/u-nueva2'), alta('nueva@x.com', { role: 'admin', puedeProgramar: true })),
    );
  });

  test('el principal borra la solicitud de alguien que no es del equipo', async () => {
    await assertFails(deleteDoc(doc(como.admin(), 'users/pendiente')));
    await assertSucceeds(deleteDoc(doc(como.super(), 'users/pendiente')));
  });

  test('«Eliminar mi cuenta»: cada quien borra solo la suya, nunca la del principal', async () => {
    await assertFails(deleteDoc(doc(como.coord(), 'users/coord2')));
    await assertFails(deleteDoc(doc(como.anonimo(), 'users/coord')));
    await assertFails(deleteDoc(doc(como.super(), 'users/super')));
    await assertSucceeds(deleteDoc(doc(como.coord(), 'users/coord')));
    await assertSucceeds(deleteDoc(doc(como.pendiente(), 'users/pendiente')));
    await assertSucceeds(deleteDoc(doc(como.inactiva(), 'users/inactiva')));
  });
});

describe('Yo la coordino: cada coordinadora se toma una fecha libre', () => {
  /** "aaaa-mm-dd" de hoy + `dias`, en Bogotá. */
  const diaBogota = (dias = 0) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.now() + dias * DIA));
  const LIBRE = diaBogota(3);
  const OTRA = diaBogota(5);
  const PASADA = diaBogota(-10);
  // Como la app: el día público solo con cuándo (y borrando la firma que
  // hubiera quedado de antes); quién fue, aparte y en el mismo lote.
  const sello = () => ({ updatedAt: serverTimestamp(), updatedBy: deleteField(), updatedByName: deleteField() });
  const tomar = (db, uid, dia, nombre = 'Marcela Sánchez', extra = {}) =>
    conFirma(db, dia, uid, (b) =>
      b.set(
        doc(db, `programacion_dias/${dia}`),
        { coordinadora: nombre, coordinadoraUid: uid, ...sello(), ...extra },
        { merge: true },
      ),
    );
  const soltar = (db, uid, dia) =>
    conFirma(db, dia, uid, (b) =>
      b.set(
        doc(db, `programacion_dias/${dia}`),
        { coordinadora: deleteField(), coordinadoraUid: deleteField(), ...sello() },
        { merge: true },
      ),
    );

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      // Un día ya asignado por la coordinación, y uno con un cambio pero libre.
      await setDoc(doc(ctx.firestore(), `programacion_dias/${OTRA}`), { coordinadora: 'Tatiana López' });
      await setDoc(doc(ctx.firestore(), `programacion_dias/${diaBogota(7)}`), { modalidad: 'virtual' });
    });
  });

  test('una coordinadora se toma una fecha libre, al instante', async () => {
    await assertSucceeds(tomar(como.coord(), 'coord', LIBRE));
    const d = (await getDoc(doc(como.coord(), `programacion_dias/${LIBRE}`))).data();
    assert.equal(d.coordinadora, 'Marcela Sánchez');
    assert.equal(d.coordinadoraUid, 'coord');
  });

  test('si el día ya tenía cambios, solo se pone ella y no toca lo demás', async () => {
    const dia = diaBogota(7);
    await assertFails(tomar(como.coord(), 'coord', dia, 'Marcela Sánchez', { modalidad: 'presencial' }));
    await assertSucceeds(tomar(como.coord(), 'coord', dia));
    const d = (await getDoc(doc(como.coord(), `programacion_dias/${dia}`))).data();
    assert.equal(d.modalidad, 'virtual');
  });

  test('no se toma una fecha que ya tiene coordinadora (aunque lleguen dos a la vez)', async () => {
    await assertFails(tomar(como.coord(), 'coord', OTRA));
    await assertSucceeds(tomar(como.coord(), 'coord', LIBRE));
    await assertFails(tomar(como.coord2(), 'coord2', LIBRE, 'Tatiana López'));
  });

  test('solo con un nombre del equipo y con su propia cuenta', async () => {
    await assertFails(tomar(como.coord(), 'coord', LIBRE, 'Alguien de afuera'));
    await assertFails(tomar(como.coord(), 'coord2', LIBRE), 'a nombre de la cuenta de otra');
    await assertFails(tomar(como.coord(), 'coord', LIBRE, 'Marcela Sánchez', { cancelada: true }), 'no puede cancelar la reunión de paso');
  });

  test('no cambia quién coordinó reuniones que ya pasaron', async () => {
    await assertFails(tomar(como.coord(), 'coord', PASADA));
  });

  test('sin acceso (pendiente o pausada) no se toma nada', async () => {
    await assertFails(tomar(como.pendiente(), 'pendiente', LIBRE));
    await assertFails(tomar(como.inactiva(), 'inactiva', LIBRE));
    await assertFails(tomar(como.anonimo(), 'x', LIBRE));
  });

  test('suelta solo la que ella se tomó', async () => {
    await assertSucceeds(tomar(como.coord(), 'coord', LIBRE));
    await assertFails(soltar(como.coord2(), 'coord2', LIBRE), 'otra no se la quita');
    await assertFails(soltar(como.coord(), 'coord', OTRA), 'la que asignó la coordinación no');
    await assertSucceeds(soltar(como.coord(), 'coord', LIBRE));
    // Queda libre otra vez: ya la puede tomar otra.
    await assertSucceeds(tomar(como.coord2(), 'coord2', LIBRE, 'Tatiana López'));
  });

  test('si quien programa la cambia de persona, se borra quién se la había tomado', async () => {
    await assertSucceeds(tomar(como.coord(), 'coord', LIBRE));
    const progra = como.progra();
    const reasignar = (extra = {}) =>
      conFirma(progra, LIBRE, 'progra', (b) =>
        b.set(
          doc(progra, `programacion_dias/${LIBRE}`),
          { coordinadora: 'Tatiana López', ...sello(), ...extra },
          { merge: true },
        ),
      );
    await assertFails(reasignar(), 'dejaría la marca de la anterior');
    await assertFails(reasignar({ coordinadoraUid: 'coord2' }), 'ni inventarse una marca');
    await assertSucceeds(reasignar({ coordinadoraUid: deleteField() }));
    // La anterior ya no la puede soltar.
    await assertFails(soltar(como.coord(), 'coord', LIBRE));
    // Quien programa sí cambia otras cosas del día sin tocar la marca.
    await assertSucceeds(tomar(como.coord2(), 'coord2', diaBogota(9), 'Tatiana López'));
    await assertSucceeds(
      conFirma(progra, diaBogota(9), 'progra', (b) =>
        b.set(doc(progra, `programacion_dias/${diaBogota(9)}`), { modalidad: 'virtual', ...sello() }, { merge: true }),
      ),
    );
  });

  test('un día con la firma vieja (de antes) se puede tomar, y la firma se borra', async () => {
    const dia = diaBogota(11);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `programacion_dias/${dia}`), {
        modalidad: 'virtual',
        updatedBy: 'admin',
        updatedByName: 'Admin de antes',
      });
    });
    await assertSucceeds(tomar(como.coord(), 'coord', dia));
    const d = (await getDoc(doc(como.anonimo(), `programacion_dias/${dia}`))).data();
    assert.equal(d.coordinadora, 'Marcela Sánchez');
    assert.equal('updatedBy' in d || 'updatedByName' in d, false);
  });
});

describe('Imágenes de las coordinadoras (para anunciar su reunión)', () => {
  const ID = 'tatiana-lopez__reduccion_ego__virtual';
  const ficha = (uid, extra = {}) => ({
    coordinadora: 'Tatiana López',
    tipo: 'reduccion_ego',
    modalidad: 'virtual',
    version: 'v1',
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    ...extra,
  });
  const subir = (db, uid, extra = {}, archivo = { datos: 'abc', version: 'v1' }) => {
    const b = writeBatch(db);
    b.set(doc(db, `imagenes_coordinadoras/${ID}`), ficha(uid, extra));
    b.set(doc(db, `imagenes_coordinadoras/${ID}/archivo/actual`), archivo);
    return b.commit();
  };

  test('las suben quienes programan; una coordinadora o alguien sin sesión no', async () => {
    await assertSucceeds(subir(como.admin(), 'admin'));
    await assertSucceeds(subir(como.progra(), 'progra'));
    await assertFails(subir(como.coord(), 'coord'));
    await assertFails(subir(como.anonimo(), 'x'));
    await assertFails(subir(como.colado(), 'colado'));
  });

  test('solo de alguien del equipo, reuniones y modalidades válidas, y sin firmar por otra', async () => {
    const db = como.admin();
    await assertFails(subir(db, 'admin', { coordinadora: 'Alguien de afuera' }));
    await assertFails(subir(db, 'admin', { tipo: 'otra' }));
    await assertFails(subir(db, 'admin', { modalidad: 'hibrida' }));
    await assertFails(subir(db, 'otra-persona'));
    await assertFails(subir(db, 'admin', { colado: 1 }));
    await assertFails(subir(db, 'admin', {}, { datos: 'x'.repeat(960000), version: 'v1' }), 'demasiado pesada');
  });

  test('la ve el equipo (también la coordinadora), no quien no tiene acceso; borra quien programa', async () => {
    await assertSucceeds(subir(como.admin(), 'admin'));
    await assertSucceeds(getDoc(doc(como.coord(), `imagenes_coordinadoras/${ID}/archivo/actual`)));
    await assertSucceeds(getDocs(collection(como.coord(), 'imagenes_coordinadoras')));
    await assertFails(getDoc(doc(como.anonimo(), `imagenes_coordinadoras/${ID}/archivo/actual`)));
    await assertFails(getDoc(doc(como.pendiente(), `imagenes_coordinadoras/${ID}`)));
    await assertFails(deleteDoc(doc(como.coord(), `imagenes_coordinadoras/${ID}`)));
    await assertSucceeds(deleteDoc(doc(como.progra(), `imagenes_coordinadoras/${ID}/archivo/actual`)));
  });
});

describe('Avisos del día antes (los teléfonos de cada quien)', () => {
  const android = (uid, extra = {}) => ({
    uid,
    nombre: 'Tatiana López',
    plataforma: 'android',
    token: 'token-fcm-de-prueba',
    updatedAt: serverTimestamp(),
    ...extra,
  });
  const web = (uid, extra = {}) => ({
    uid,
    nombre: 'Tatiana López',
    plataforma: 'web',
    suscripcion: { endpoint: 'https://web.push.apple.com/abc', p256dh: 'BKx', auth: 'aut' },
    updatedAt: serverTimestamp(),
    ...extra,
  });

  test('cada quien registra SUS teléfonos (también una coordinadora); sin acceso no', async () => {
    await assertSucceeds(setDoc(doc(como.coord(), 'avisos/coord__telefono01'), android('coord')));
    await assertSucceeds(setDoc(doc(como.coord(), 'avisos/coord__iphone0001'), web('coord')));
    await assertFails(setDoc(doc(como.coord(), 'avisos/coord2__telefono01'), android('coord2')), 'con el id de otra');
    await assertFails(setDoc(doc(como.coord(), 'avisos/coord__telefono02'), android('coord2')), 'a nombre de otra cuenta');
    await assertFails(setDoc(doc(como.pendiente(), 'avisos/pendiente__telefono01'), android('pendiente')));
    await assertFails(setDoc(doc(como.inactiva(), 'avisos/inactiva__telefono01'), android('inactiva')));
    await assertFails(setDoc(doc(como.anonimo(), 'avisos/x__telefono01'), android('x')));
  });

  test('solo nombres del equipo, datos con forma y nada colado', async () => {
    const db = como.coord();
    await assertFails(setDoc(doc(db, 'avisos/coord__telefono01'), android('coord', { nombre: 'Alguien de afuera' })));
    await assertFails(setDoc(doc(db, 'avisos/coord__telefono01'), android('coord', { plataforma: 'ios' })));
    await assertFails(setDoc(doc(db, 'avisos/coord__telefono01'), android('coord', { colado: 1 })));
    await assertFails(setDoc(doc(db, 'avisos/coord__telefono01'), android('coord', { token: 'x'.repeat(5000) })));
    await assertFails(setDoc(doc(db, 'avisos/coord__telefono01'), android('coord', { suscripcion: web('coord').suscripcion })));
    await assertFails(
      setDoc(doc(db, 'avisos/coord__iphone0001'), web('coord', { suscripcion: { endpoint: 'http://inseguro', p256dh: 'a', auth: 'b' } })),
    );
    await assertFails(setDoc(doc(db, 'avisos/coord__x'), android('coord')), 'id de dispositivo muy corto');
    await assertFails(setDoc(doc(db, 'avisos/coord__telefono01'), android('coord', { updatedAt: Timestamp.now() })));
  });

  test('nadie lee ni borra los teléfonos de otra persona (ni la administración desde la app)', async () => {
    await assertSucceeds(setDoc(doc(como.coord(), 'avisos/coord__telefono01'), android('coord')));
    await assertSucceeds(getDoc(doc(como.coord(), 'avisos/coord__telefono01')));
    await assertFails(getDoc(doc(como.coord2(), 'avisos/coord__telefono01')));
    await assertFails(getDoc(doc(como.admin(), 'avisos/coord__telefono01')));
    await assertFails(getDocs(collection(como.admin(), 'avisos')));
    await assertFails(getDoc(doc(como.anonimo(), 'avisos/coord__telefono01')));
    await assertFails(deleteDoc(doc(como.coord2(), 'avisos/coord__telefono01')));
    await assertSucceeds(deleteDoc(doc(como.coord(), 'avisos/coord__telefono01')));
  });
});

describe('Recursos de la reunión: enlaces de Meet y carpeta', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'programacion/enlaces'), {
        meet: { entrega_pasos: 'https://meet.google.com/aaa-bbbb-ccc' },
      });
      await setDoc(doc(db, 'carpeta/actual'), { version: 'v1', nombre: 'Carpeta', paginas: 1, partesPdf: 1 });
      await setDoc(doc(db, 'carpeta/actual/paginas/0'), { n: 0, version: 'v1', datos: 'abc' });
      await setDoc(doc(db, 'carpeta/actual/pdf/0'), { n: 0, version: 'v1', datos: 'abc' });
    });
  });
  const enlaces = (uid, extra = {}) => ({
    meet: { entrega_pasos: 'https://meet.google.com/zzz-yyyy-xxx', reduccion_ego: 'https://meet.google.com/qqq-wwww-eee' },
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    updatedByName: uid,
    ...extra,
  });

  test('los enlaces de Meet no son públicos: solo los lee el equipo', async () => {
    await assertFails(getDoc(doc(como.anonimo(), 'programacion/enlaces')));
    await assertFails(getDoc(doc(como.pendiente(), 'programacion/enlaces')));
    await assertFails(getDoc(doc(como.inactiva(), 'programacion/enlaces')));
    await assertSucceeds(getDoc(doc(como.coord(), 'programacion/enlaces')));
    // La configuración del calendario sigue siendo pública.
    await assertSucceeds(getDoc(doc(como.anonimo(), 'programacion/config')));
  });

  test('los enlaces los cambia quien programa, y con forma válida', async () => {
    await assertFails(setDoc(doc(como.coord(), 'programacion/enlaces'), enlaces('coord')));
    await assertSucceeds(setDoc(doc(como.progra(), 'programacion/enlaces'), enlaces('progra')));
    await assertSucceeds(setDoc(doc(como.admin(), 'programacion/enlaces'), enlaces('admin')));
    await assertFails(setDoc(doc(como.admin(), 'programacion/enlaces'), enlaces('admin', { colado: 1 })));
    await assertFails(
      setDoc(doc(como.admin(), 'programacion/enlaces'), enlaces('admin', { meet: { otra_reunion: 'https://x.y' } })),
    );
    await assertFails(setDoc(doc(como.admin(), 'programacion/enlaces'), enlaces('otra-persona')));
    await assertFails(setDoc(doc(como.admin(), 'programacion/otra-cosa'), enlaces('admin')));
  });

  test('la carpeta solo la ve el equipo, y nadie la cambia desde la app', async () => {
    for (const ruta of ['carpeta/actual', 'carpeta/actual/paginas/0']) {
      await assertFails(getDoc(doc(como.anonimo(), ruta)), `anónimo lee ${ruta}`);
      await assertFails(getDoc(doc(como.pendiente(), ruta)), `pendiente lee ${ruta}`);
      await assertSucceeds(getDoc(doc(como.coord(), ruta)), `coordinadora lee ${ruta}`);
    }
    await assertSucceeds(getDocs(collection(como.coord(), 'carpeta/actual/paginas')));
    // Solo para leer en la app: el PDF (para descargarlo) no lo lee nadie.
    for (const quien of ['coord', 'admin', 'super']) {
      await assertFails(getDoc(doc(como[quien](), 'carpeta/actual/pdf/0')), `${quien} lee el PDF`);
      await assertFails(getDocs(collection(como[quien](), 'carpeta/actual/pdf')), `${quien} lista el PDF`);
    }
    await assertFails(setDoc(doc(como.super(), 'carpeta/actual'), { version: 'v2' }));
    await assertFails(setDoc(doc(como.admin(), 'carpeta/actual/paginas/1'), { n: 1, version: 'v1', datos: 'x' }));
    await assertFails(deleteDoc(doc(como.admin(), 'carpeta/actual/pdf/0')));
  });
});
