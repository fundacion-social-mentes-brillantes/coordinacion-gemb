// Copia la programación del Calendario viejo (proyecto Firebase
// "calendario-mentes-brillantes") a Coordinación. Del viejo SOLO lee: no lo
// cambia ni lo borra. En el destino solo CREA lo que falta: si se corre dos
// veces, o si alguien ya cambió algo en el calendario nuevo, no lo pisa.
//
//   node scripts/migrar-calendario.mjs emulador      (prueba local)
//   node scripts/migrar-calendario.mjs produccion    (la base real)
//
// Usa la llave de servicio ya configurada en este PC (gcloud).

import { execSync } from 'node:child_process';

const destino = process.argv[2];
if (destino !== 'emulador' && destino !== 'produccion') {
  console.error('Uso: node scripts/migrar-calendario.mjs emulador|produccion');
  process.exit(1);
}

const token = execSync(
  'gcloud auth print-access-token --account=clara-agente@clara-gemb.iam.gserviceaccount.com',
  { encoding: 'utf8', shell: true },
).trim();

const ORIGEN = 'https://firestore.googleapis.com/v1/projects/calendario-mentes-brillantes/databases/(default)/documents';
const PROYECTO = destino === 'emulador' ? 'demo-gemb' : 'coordinacion-gemb';
const RAIZ = `projects/${PROYECTO}/databases/(default)/documents`;
const DESTINO =
  destino === 'emulador'
    ? `http://127.0.0.1:8080/v1/${RAIZ}`
    : `https://firestore.googleapis.com/v1/${RAIZ}`;
const AUTH_DESTINO = destino === 'emulador' ? 'Bearer owner' : `Bearer ${token}`;

// El equipo con la ortografía que usa Coordinación.
const EQUIPO_BASE = [
  'Alexandra Ortega',
  'Eva Simbaqueba',
  'Jessica Becerra',
  'Marcela Sánchez',
  'Tatiana López',
];
const sinTildes = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const mayusculas = (s) =>
  s.trim().replace(/\s+/g, ' ').split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/* ---------------- lectura ---------------- */

const valor = (v) =>
  v == null ? null
  : 'stringValue' in v ? v.stringValue
  : 'integerValue' in v ? Number(v.integerValue)
  : 'booleanValue' in v ? v.booleanValue
  : 'timestampValue' in v ? v.timestampValue
  : 'arrayValue' in v ? (v.arrayValue.values ?? []).map(valor)
  : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, valor(x)]))
  : null;

async function leerColeccion(base, auth, nombre) {
  const r = await fetch(`${base}/${nombre}?pageSize=1000`, { headers: { Authorization: auth } });
  if (!r.ok) throw new Error(`No se pudo leer ${nombre}: HTTP ${r.status}`);
  const j = await r.json();
  return (j.documents ?? []).map((d) => ({
    id: decodeURIComponent(d.name.split('/').pop()),
    ...Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, v]) => [k, valor(v)])),
  }));
}

const viejo = `Bearer ${token}`;
const [mentores, asignaciones, base, especiales] = await Promise.all([
  leerColeccion(ORIGEN, viejo, 'mentores'),
  leerColeccion(ORIGEN, viejo, 'asignaciones'),
  leerColeccion(ORIGEN, viejo, 'configuracionBase'),
  leerColeccion(ORIGEN, viejo, 'configuracionDias'),
]);

/* ---------------- traducción ---------------- */

const equipo = [...EQUIPO_BASE];
const canonico = (nombre) => {
  const n = sinTildes(nombre);
  const hit = equipo.find((e) => sinTildes(e) === n);
  if (hit) return hit;
  const nuevo = mayusculas(nombre);
  equipo.push(nuevo);
  return nuevo;
};
for (const m of mentores) canonico(m.nombre ?? m.id);

const tipos = (texto = '') => {
  const t = sinTildes(texto);
  const out = [];
  if (t.includes('ego')) out.push('reduccion_ego');
  if (t.includes('pasos')) out.push('entrega_pasos');
  return out;
};

const dias = {};
for (let i = 0; i < 7; i++) {
  const b = base.find((x) => Number(x.dia ?? x.id) === i) ?? {};
  dias[String(i)] = {
    activo: b.activo === true,
    actividades: tipos(b.actividad),
    horario: b.horario ?? '',
    siempreVirtual: b.esVirtualSiempre === true,
  };
}

const config = {
  dias,
  coordinadoras: equipo,
  desde: '2026-02-03', // START_DATE del Calendario viejo
  hasta: '2026-12-10', // END_DATE
  semanasVirtuales: 'par', // semanas ISO pares = virtual
  grupoWhatsapp: 'https://chat.whatsapp.com/EodgViFsvmyK0dRnGatDyK',
};

const firma = {
  updatedAt: new Date(),
  updatedBy: 'migracion-calendario',
  updatedByName: 'Calendario anterior',
};
const porDia = new Map();
for (const a of asignaciones) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.id) || !a.mentor_nombre) continue;
  porDia.set(a.id, { coordinadora: canonico(a.mentor_nombre) });
}
for (const e of especiales) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.id)) continue;
  porDia.set(e.id, {
    ...(porDia.get(e.id) ?? {}),
    especial: true,
    actividades: tipos(e.actividad),
    horario: e.horario ?? '',
  });
}

/* ---------------- escritura (solo lo que falta) ---------------- */

const aRest = (v) =>
  v === null || v === undefined ? { nullValue: null }
  : v instanceof Date ? { timestampValue: v.toISOString() }
  : typeof v === 'string' ? { stringValue: v }
  : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? { integerValue: String(v) }
  : Array.isArray(v) ? { arrayValue: { values: v.map(aRest) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, aRest(x)])) } };
const campos = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, aRest(v)]));

const existentes = new Set((await leerColeccion(DESTINO, AUTH_DESTINO, 'programacion_dias')).map((d) => d.id));
const hayConfig = (await leerColeccion(DESTINO, AUTH_DESTINO, 'programacion')).some((d) => d.id === 'config');

const writes = [];
if (!hayConfig) {
  writes.push({
    update: { name: `${RAIZ}/programacion/config`, fields: campos({ ...config, ...firma }) },
    currentDocument: { exists: false },
  });
}
for (const [dia, datos] of porDia) {
  if (existentes.has(dia)) continue;
  writes.push({
    update: { name: `${RAIZ}/programacion_dias/${dia}`, fields: campos({ ...datos, ...firma }) },
    currentDocument: { exists: false },
  });
}

console.log(`Destino: ${destino} (${PROYECTO})`);
console.log(`Equipo (${equipo.length}): ${equipo.join(', ')}`);
console.log(`Configuración: ${hayConfig ? 'ya existía, no se toca' : 'se crea'}`);
console.log(`Días: ${porDia.size} en el Calendario viejo, ${writes.length - (hayConfig ? 0 : 1)} por crear, ${existentes.size} ya había`);

for (let i = 0; i < writes.length; i += 400) {
  const r = await fetch(`${DESTINO}:commit`, {
    method: 'POST',
    headers: { Authorization: AUTH_DESTINO, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: writes.slice(i, i + 400) }),
  });
  if (!r.ok) throw new Error(`No se pudo guardar: HTTP ${r.status} ${await r.text()}`);
}
console.log('Listo.');
