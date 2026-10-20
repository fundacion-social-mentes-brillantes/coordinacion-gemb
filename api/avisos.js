// mcp/src/avisos-http.ts
import { timingSafeEqual } from "node:crypto";

// mcp/src/avisos.ts
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";

// src/lib/constants.ts
var SESSION_TYPE_LABELS = {
  entrega_pasos: "Entrega de Pasos",
  reduccion_ego: "Sala de Reducci\xF3n del Ego"
};
var MODALITY_LABELS = {
  virtual: "Virtual",
  presencial: "Presencial"
};
var COORDINATOR_NAMES = [
  "Alexandra Ortega",
  "Eva Simbaqueba",
  "Jessica Becerra",
  "Marcela S\xE1nchez",
  "Tatiana L\xF3pez"
];

// src/lib/normalize.ts
var DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

// src/lib/dates.ts
var DIA_BOGOTA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
function sessionDateFromKey(key) {
  return /* @__PURE__ */ new Date(`${key}T12:00:00-05:00`);
}

// src/lib/programacion.ts
var HORARIO = "5:30 PM - 6:45 PM";
var CONFIG_INICIAL = {
  dias: {
    "0": { activo: false, actividades: [], horario: "", siempreVirtual: false },
    "1": { activo: false, actividades: [], horario: "", siempreVirtual: false },
    "2": { activo: true, actividades: ["reduccion_ego"], horario: HORARIO, siempreVirtual: false },
    "3": { activo: false, actividades: [], horario: "", siempreVirtual: false },
    "4": { activo: true, actividades: ["entrega_pasos"], horario: HORARIO, siempreVirtual: false },
    "5": { activo: false, actividades: [], horario: "", siempreVirtual: false },
    "6": {
      activo: false,
      actividades: ["reduccion_ego", "entrega_pasos"],
      horario: "3:00 PM - 5:00 PM",
      siempreVirtual: true
    }
  },
  coordinadoras: [...COORDINATOR_NAMES],
  desde: "2026-02-03",
  hasta: "2026-12-10",
  semanasVirtuales: "par",
  grupoWhatsapp: ""
};
var NOMBRES_DIA = ["Domingo", "Lunes", "Martes", "Mi\xE9rcoles", "Jueves", "Viernes", "S\xE1bado"];
var utc = (y, m, d) => new Date(Date.UTC(y, m, d, 12));
var claveDe = (d) => d.toISOString().slice(0, 10);
var deClave = (key) => /* @__PURE__ */ new Date(`${key}T12:00:00Z`);
function semanaISO(key) {
  const d = deClave(key);
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dia);
  const inicio = Date.UTC(d.getUTCFullYear(), 0, 1, 12);
  return Math.ceil(((d.getTime() - inicio) / 864e5 + 1) / 7);
}
function pascua(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = (h + l - 7 * m + 114) % 31 + 1;
  return utc(y, mes - 1, dia);
}
var sumarDias = (d, n) => utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n);
var alLunes = (d) => sumarDias(d, (8 - d.getUTCDay()) % 7);
var cacheFestivos = /* @__PURE__ */ new Map();
function festivosColombia(y) {
  const hit = cacheFestivos.get(y);
  if (hit) return hit;
  const f = /* @__PURE__ */ new Map();
  const poner = (d, nombre) => f.set(claveDe(d), nombre);
  poner(utc(y, 0, 1), "A\xF1o Nuevo");
  poner(alLunes(utc(y, 0, 6)), "Reyes Magos");
  poner(alLunes(utc(y, 2, 19)), "San Jos\xE9");
  const p = pascua(y);
  poner(sumarDias(p, -3), "Jueves Santo");
  poner(sumarDias(p, -2), "Viernes Santo");
  poner(utc(y, 4, 1), "D\xEDa del Trabajo");
  poner(sumarDias(p, 43), "Ascensi\xF3n del Se\xF1or");
  poner(sumarDias(p, 64), "Corpus Christi");
  poner(sumarDias(p, 71), "Sagrado Coraz\xF3n");
  poner(alLunes(utc(y, 5, 29)), "San Pedro y San Pablo");
  poner(utc(y, 6, 20), "D\xEDa de la Independencia");
  poner(utc(y, 7, 7), "Batalla de Boyac\xE1");
  poner(alLunes(utc(y, 7, 15)), "Asunci\xF3n de la Virgen");
  poner(alLunes(utc(y, 9, 12)), "D\xEDa de la Diversidad \xC9tnica y Cultural");
  poner(alLunes(utc(y, 10, 1)), "Todos los Santos");
  poner(alLunes(utc(y, 10, 11)), "Independencia de Cartagena");
  poner(utc(y, 11, 8), "Inmaculada Concepci\xF3n");
  poner(utc(y, 11, 25), "Navidad");
  cacheFestivos.set(y, f);
  return f;
}
function modalidadPorRegla(key, base, c) {
  if (base?.siempreVirtual) return "virtual";
  const par = semanaISO(key) % 2 === 0;
  return par === (c.semanasVirtuales === "par") ? "virtual" : "presencial";
}
function planDeFecha(key, c, dias) {
  const d = deClave(key);
  const diaSemana = d.getUTCDay();
  const base = c.dias[String(diaSemana)];
  const cambio = dias.get(key);
  const especial = cambio?.especial === true;
  const enTemporada = key >= c.desde && key <= c.hasta;
  if (!especial && !(base?.activo && enTemporada)) return null;
  const actividades = cambio?.actividades?.length ? cambio.actividades : base?.actividades?.length ? base.actividades : ["reduccion_ego"];
  return {
    key,
    fecha: sessionDateFromKey(key),
    diaSemana,
    actividades,
    horario: cambio?.horario || base?.horario || "",
    modalidad: cambio?.modalidad ?? modalidadPorRegla(key, base, c),
    modalidadFija: !!cambio?.modalidad,
    coordinadora: cambio?.coordinadora ?? "",
    coordinadoraUid: cambio?.coordinadora ? cambio.coordinadoraUid ?? "" : "",
    festivo: especial ? null : festivosColombia(d.getUTCFullYear()).get(key) ?? null,
    cancelada: cambio?.cancelada === true,
    motivo: cambio?.motivo ?? "",
    especial
  };
}
var hayReunion = (p) => !p.festivo && !p.cancelada;
function completarConfig(parcial) {
  const c = parcial ?? {};
  const dias = {};
  for (let i = 0; i < 7; i++) {
    const k = String(i);
    const d = (c.dias ?? {})[k];
    dias[k] = d ? {
      activo: d.activo === true,
      actividades: Array.isArray(d.actividades) ? d.actividades : [],
      horario: typeof d.horario === "string" ? d.horario : "",
      siempreVirtual: d.siempreVirtual === true
    } : CONFIG_INICIAL.dias[k];
  }
  return {
    dias,
    coordinadoras: Array.isArray(c.coordinadoras) && c.coordinadoras.length ? c.coordinadoras : CONFIG_INICIAL.coordinadoras,
    desde: typeof c.desde === "string" && c.desde ? c.desde : CONFIG_INICIAL.desde,
    hasta: typeof c.hasta === "string" && c.hasta ? c.hasta : CONFIG_INICIAL.hasta,
    semanasVirtuales: c.semanasVirtuales === "impar" ? "impar" : "par",
    grupoWhatsapp: typeof c.grupoWhatsapp === "string" ? c.grupoWhatsapp : ""
  };
}
var moverDia = (key, n) => claveDe(sumarDias(deClave(key), n));

// src/lib/mensajesCoordina.ts
var PLANTILLAS = [
  (d) => `\xA1Hola, familia GEMB! \u{1F31F} ${may(d.cuando)} los espero en ${d.reunion}, a las ${d.hora} (${d.modalidad}). \xA1Ser\xE1 un gusto acompa\xF1arlos!`,
  (d) => `Bienvenidos ${d.cuando} a ${d.reunion} \u2728 Nos vemos a las ${d.hora} (${d.modalidad}). \xA1Los espero con mucho cari\xF1o!`,
  (d) => `\xA1${may(d.cuando)} tenemos encuentro! \u{1F49B} ${may(d.reunion)}, a las ${d.hora} (${d.modalidad}). Te espero.`,
  (d) => `Recordatorio con cari\xF1o: ${d.cuando} es ${d.reunion}, a las ${d.hora} (${d.modalidad}). \xA1All\xE1 nos vemos!`,
  (d) => `Te espero ${d.cuando} en ${d.reunion} \u{1F64C} A las ${d.hora}, ${d.modalidad}. \xA1No faltes!`,
  (d) => `\xA1Prep\xE1rate para ${d.cuando}! ${may(d.reunion)}, a las ${d.hora} (${d.modalidad}). Me alegra mucho acompa\xF1arte. \u{1F331}`,
  (d) => `${may(d.cuando)} nos encontramos en ${d.reunion} \u{1F90D} A las ${d.hora}, ${d.modalidad}. \xA1Te espero con los brazos abiertos!`,
  (d) => `Querida familia: ${d.cuando} los acompa\xF1o en ${d.reunion}, a las ${d.hora} (${d.modalidad}). \xA1Nos vemos all\xE1! \u2728`
];
var CUANTOS_MENSAJES = PLANTILLAS.length;
var may = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function horaDe(horario) {
  const m = horario.match(/(\d{1,2}:\d{2})\s*(AM|PM)/i);
  if (!m) return horario || "la hora de siempre";
  return `${m[1]} ${m[2].toUpperCase() === "AM" ? "a. m." : "p. m."}`;
}
function avisoDiaAntes(p, tipo) {
  const dia = `${NOMBRES_DIA[p.diaSemana].toLowerCase()} ${p.fecha.getUTCDate()}`;
  return {
    titulo: "Ma\xF1ana coordinas t\xFA \u2728",
    cuerpo: `${SESSION_TYPE_LABELS[tipo]} \xB7 ${dia} \xB7 ${MODALITY_LABELS[p.modalidad].toLowerCase()}, ${horaDe(p.horario)}. Toca aqu\xED para mandar tu imagen al grupo.`
  };
}
var AVISO_DE_PRUEBA = {
  titulo: "\xA1Listo! As\xED te llegar\xE1 el aviso \u{1F514}",
  cuerpo: "El d\xEDa antes de coordinar te aviso aqu\xED, con tu imagen y el mensaje listos para el grupo."
};

// mcp/src/rest.ts
var EMU_FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
var EMU_AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
var PROJECT_ID = EMU_FIRESTORE && process.env.GEMB_PROJECT_ID || "coordinacion-gemb";
var API_KEY = "AIzaSyB-KQMYvpKun5oxQhqTSyF-ElhJxAp-eGQ";
var RAIZ_DOCS = `projects/${PROJECT_ID}/databases/(default)/documents`;
var DOCS = EMU_FIRESTORE ? `http://${EMU_FIRESTORE}/v1/${RAIZ_DOCS}` : `https://firestore.googleapis.com/v1/${RAIZ_DOCS}`;
var TOKEN_URL = EMU_AUTH ? `http://${EMU_AUTH}/securetoken.googleapis.com/v1/token?key=${API_KEY}` : `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`;
function valor(v) {
  if (v === null || typeof v !== "object") return v;
  const o = v;
  if ("stringValue" in o) return o.stringValue;
  if ("booleanValue" in o) return o.booleanValue;
  if ("integerValue" in o) return Number(o.integerValue);
  if ("doubleValue" in o) return o.doubleValue;
  if ("timestampValue" in o) return new Date(o.timestampValue);
  if ("nullValue" in o) return null;
  if ("arrayValue" in o) {
    return (o.arrayValue.values ?? []).map(valor);
  }
  if ("mapValue" in o) {
    return campos(o.mapValue.fields);
  }
  if ("referenceValue" in o) return o.referenceValue;
  return void 0;
}
function campos(f) {
  const salida = {};
  for (const [k, v] of Object.entries(f ?? {})) salida[k] = valor(v);
  return salida;
}

// mcp/src/avisos.ts
var PROYECTO = "coordinacion-gemb";
var PROYECTO_NUMERO = "1019293780998";
var CUENTA = `avisos-vercel@${PROYECTO}.iam.gserviceaccount.com`;
var AUDIENCIA_WIF = `//iam.googleapis.com/projects/${PROYECTO_NUMERO}/locations/global/workloadIdentityPools/vercel/providers/vercel`;
var VAPID_PUBLICA = "BDIoqLNsfEZh0RI-agU5AkzaoeFRG7VbuAobxVYh6rET5KOHRN_EFgd4xaiA7YAW-4YTUz7YUsQ4qH_FA_x1kq0";
var CONTACTO_VAPID = "https://coordinacion-gemb.vercel.app";
var docsDe = (base = `https://firestore.googleapis.com/v1`, proyecto = PROYECTO) => `${base}/projects/${proyecto}/databases/(default)/documents`;
async function permisoDeServidor(oidc) {
  const r1 = await fetch("https://sts.googleapis.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: AUDIENCIA_WIF,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      subjectToken: oidc
    })
  });
  const d1 = await r1.json();
  if (!r1.ok || !d1.access_token) throw new Error(`STS: ${d1.error_description ?? r1.status}`);
  const r2 = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${CUENTA}:generateAccessToken`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${d1.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/cloud-platform"] })
    }
  );
  const d2 = await r2.json();
  if (!r2.ok || !d2.accessToken) throw new Error(`IAM: ${d2.error?.message ?? r2.status}`);
  return { token: d2.accessToken, hasta: Date.parse(d2.expireTime ?? "") || Date.now() + 50 * 6e4 };
}
async function leerDoc(g, ruta) {
  const r = await fetch(`${g.docs}/${ruta}`, { headers: { Authorization: `Bearer ${g.token}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Firestore ${ruta}: HTTP ${r.status}`);
  const d = await r.json();
  return campos(d.fields);
}
async function planDe(g, key) {
  const [config, dia] = await Promise.all([leerDoc(g, "programacion/config"), leerDoc(g, `programacion_dias/${key}`)]);
  const dias = /* @__PURE__ */ new Map();
  if (dia) dias.set(key, dia);
  return planDeFecha(key, completarConfig(config ?? void 0), dias);
}
async function dispositivos(g, campo, valor2) {
  const r = await fetch(`${g.docs}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${g.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "avisos" }],
        where: { fieldFilter: { field: { fieldPath: campo }, op: "EQUAL", value: { stringValue: valor2 } } },
        limit: 50
      }
    })
  });
  if (!r.ok) throw new Error(`Firestore avisos: HTTP ${r.status}`);
  const filas = await r.json();
  const salida = [];
  for (const f of filas) {
    if (!f.document) continue;
    const c = campos(f.document.fields);
    if (c.plataforma !== "android" && c.plataforma !== "web") continue;
    salida.push({
      ruta: f.document.name.split("/documents/")[1] ?? "",
      uid: String(c.uid ?? ""),
      nombre: String(c.nombre ?? ""),
      plataforma: c.plataforma,
      token: typeof c.token === "string" ? c.token : void 0,
      suscripcion: c.suscripcion
    });
  }
  return salida;
}
async function borrar(g, ruta) {
  await fetch(`${g.docs}/${ruta}`, { method: "DELETE", headers: { Authorization: `Bearer ${g.token}` } }).catch(() => {
  });
}
async function enviarFcm(g, token, a) {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${PROYECTO}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${g.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        // Con «notification» la muestra el propio Android aunque la app esté
        // cerrada; «data» es para cuando está abierta (AvisosServicio.java).
        notification: { title: a.titulo, body: a.cuerpo },
        data: { titulo: a.titulo, cuerpo: a.cuerpo, ruta: a.ruta, etiqueta: a.etiqueta },
        android: {
          priority: "HIGH",
          ttl: "72000s",
          notification: { channel_id: "coordinar", icon: "ic_aviso", color: "#D6B064", tag: a.etiqueta }
        }
      }
    })
  });
  if (r.ok) return "ok";
  const d = await r.json().catch(() => ({}));
  const codigos = (d.error?.details ?? []).map((x) => x.errorCode);
  if (r.status === 404 || codigos.includes("UNREGISTERED")) return "caducado";
  if (r.status === 400 && /registration token/i.test(d.error?.message ?? "")) return "caducado";
  console.warn("FCM no acept\xF3 el aviso", r.status, d.error?.status, d.error?.message);
  return "error";
}
var hmac = (llave, datos) => createHmac("sha256", llave).update(datos).digest();
var b64 = (s) => Buffer.from(s, "base64url");
function cifrarWebPush(texto, sub, sal = randomBytes(16), efimera) {
  const ua = b64(sub.p256dh);
  const secreto = b64(sub.auth);
  let e = efimera;
  if (!e) {
    e = createECDH("prime256v1");
    e.generateKeys();
  }
  const nuestra = e.getPublicKey();
  const compartido = e.computeSecret(ua);
  const ikm = hmac(hmac(secreto, compartido), Buffer.concat([Buffer.from("WebPush: info\0"), ua, nuestra, Buffer.from([1])]));
  const prk = hmac(sal, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0", "binary")).subarray(0, 12);
  const c = createCipheriv("aes-128-gcm", cek, nonce);
  const cifrado = Buffer.concat([c.update(Buffer.concat([Buffer.from(texto, "utf8"), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const cabecera2 = Buffer.alloc(21);
  sal.copy(cabecera2, 0);
  cabecera2.writeUInt32BE(4096, 16);
  cabecera2.writeUInt8(nuestra.length, 20);
  return Buffer.concat([cabecera2, nuestra, cifrado]);
}
function llaveVapid(privada, publica = VAPID_PUBLICA) {
  const pub = b64(publica);
  const d = b64(privada);
  const d32 = d.length >= 32 ? d.subarray(d.length - 32) : Buffer.concat([Buffer.alloc(32 - d.length), d]);
  return createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: d32.toString("base64url"),
      x: pub.subarray(1, 33).toString("base64url"),
      y: pub.subarray(33, 65).toString("base64url")
    },
    format: "jwk"
  });
}
function firmaVapid(endpoint, llave, publica = VAPID_PUBLICA) {
  const parte = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const cuerpo = `${parte({ typ: "JWT", alg: "ES256" })}.${parte({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1e3) + 12 * 3600,
    sub: CONTACTO_VAPID
  })}`;
  const firma = sign("sha256", Buffer.from(cuerpo), { key: llave, dsaEncoding: "ieee-p1363" });
  return `vapid t=${cuerpo}.${firma.toString("base64url")}, k=${publica}`;
}
async function enviarWeb(sub, a, llave) {
  let r;
  try {
    r = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: firmaVapid(sub.endpoint, llave),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "72000",
        Urgency: "high"
      },
      body: Uint8Array.from(cifrarWebPush(JSON.stringify(a), sub))
    });
  } catch (e) {
    console.warn("No se pudo llegar al servicio de avisos", e);
    return "error";
  }
  if (r.ok) return "ok";
  if (r.status === 404 || r.status === 410) return "caducado";
  console.warn("El servicio de avisos no acept\xF3", r.status, (await r.text().catch(() => "")).slice(0, 200));
  return "error";
}
function enviadoresReales(g, vapidPrivada) {
  const llave = vapidPrivada ? llaveVapid(vapidPrivada) : null;
  return {
    fcm: (token, a) => enviarFcm(g, token, a),
    web: async (sub, a) => {
      if (!llave) {
        console.warn("Falta VAPID_PRIVADA: no se pueden mandar avisos web");
        return "error";
      }
      return enviarWeb(sub, a, llave);
    }
  };
}
async function repartir(g, lista, a, env) {
  const r = { enviados: 0, caducados: 0, fallidos: 0 };
  await Promise.all(
    lista.map(async (d) => {
      let res = "error";
      if (d.plataforma === "android" && d.token) res = await env.fcm(d.token, a);
      else if (d.plataforma === "web" && d.suscripcion?.endpoint) res = await env.web(d.suscripcion, a);
      if (res === "ok") r.enviados++;
      else if (res === "caducado") {
        r.caducados++;
        await borrar(g, d.ruta);
      } else r.fallidos++;
    })
  );
  return r;
}
var hoyEnBogota = (ahora = /* @__PURE__ */ new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(ahora);
async function avisarManana(g, env, hoy = hoyEnBogota()) {
  const fecha = moverDia(hoy, 1);
  const p = await planDe(g, fecha);
  if (!p || !hayReunion(p)) return { fecha, coordinadora: "", motivo: "no hay reuni\xF3n" };
  if (!p.coordinadora) return { fecha, coordinadora: "", motivo: "sin coordinadora" };
  const lista = await dispositivos(g, "nombre", p.coordinadora);
  if (!lista.length) return { fecha, coordinadora: p.coordinadora, motivo: "no activ\xF3 los avisos", enviados: 0 };
  const tipo = p.actividades[0] ?? "reduccion_ego";
  const aviso = { ...avisoDiaAntes(p, tipo), ruta: "/sesiones", etiqueta: `coordinar-${fecha}` };
  return { fecha, coordinadora: p.coordinadora, ...await repartir(g, lista, aviso, env) };
}
async function avisoDePrueba(g, env, uid) {
  const lista = await dispositivos(g, "uid", uid);
  const aviso = { ...AVISO_DE_PRUEBA, ruta: "/sesiones", etiqueta: "prueba" };
  return { dispositivos: lista.length, ...await repartir(g, lista, aviso, env) };
}

// mcp/src/avisos-http.ts
var API_KEY2 = "AIzaSyB-KQMYvpKun5oxQhqTSyF-ElhJxAp-eGQ";
var cabecera = (req, k) => {
  const v = req.headers[k];
  return (Array.isArray(v) ? v[0] : v) ?? "";
};
var portador = (req) => cabecera(req, "authorization").replace(/^Bearer\s+/i, "").trim();
function igual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
var permiso = null;
async function google(req) {
  if (permiso && permiso.hasta - Date.now() > 5 * 6e4) return { docs: docsDe(), token: permiso.token };
  const oidc = cabecera(req, "x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || "";
  if (!oidc) throw new Error("Falta el certificado de Vercel (OIDC)");
  permiso = await permisoDeServidor(oidc);
  return { docs: docsDe(), token: permiso.token };
}
async function uidDe(idToken) {
  if (!idToken) return null;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY2}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d.users?.[0]?.localId ?? null;
}
var ultimaPrueba = /* @__PURE__ */ new Map();
async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const secreto = process.env.CRON_SECRET ?? "";
      if (!secreto || !igual(portador(req), secreto)) {
        res.status(401).json({ error: "No autorizado" });
        return;
      }
      const hoy = new URL(req.url ?? "", "https://x").searchParams.get("hoy");
      const g = await google(req);
      const resumen = await avisarManana(
        g,
        enviadoresReales(g, process.env.VAPID_PRIVADA),
        hoy && /^\d{4}-\d{2}-\d{2}$/.test(hoy) ? hoy : hoyEnBogota()
      );
      console.log("avisos del d\xEDa antes", JSON.stringify(resumen));
      res.status(200).json(resumen);
      return;
    }
    if (req.method === "POST") {
      const cuerpo = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body ?? {};
      if (cuerpo.accion !== "prueba") {
        res.status(400).json({ error: "Acci\xF3n desconocida" });
        return;
      }
      const uid = await uidDe(portador(req));
      if (!uid) {
        res.status(401).json({ error: "Vuelve a entrar a la app" });
        return;
      }
      const antes = ultimaPrueba.get(uid) ?? 0;
      if (Date.now() - antes < 2e4) {
        res.status(429).json({ error: "Espera unos segundos y vuelve a probar" });
        return;
      }
      ultimaPrueba.set(uid, Date.now());
      const g = await google(req);
      const r = await avisoDePrueba(g, enviadoresReales(g, process.env.VAPID_PRIVADA), uid);
      res.status(200).json(r);
      return;
    }
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "M\xE9todo no permitido" });
  } catch (e) {
    console.error("avisos: fall\xF3", e);
    res.status(500).json({ error: "No se pudo mandar el aviso" });
  }
}
export {
  handler as default
};
