// mcp/src/rest.ts
var EMU_FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST;
var EMU_AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
var PROJECT_ID = EMU_FIRESTORE && process.env.GEMB_PROJECT_ID || "coordinacion-gemb";
var API_KEY = "AIzaSyB-KQMYvpKun5oxQhqTSyF-ElhJxAp-eGQ";
var RAIZ_DOCS = `projects/${PROJECT_ID}/databases/(default)/documents`;
var DOCS = EMU_FIRESTORE ? `http://${EMU_FIRESTORE}/v1/${RAIZ_DOCS}` : `https://firestore.googleapis.com/v1/${RAIZ_DOCS}`;
var TOKEN_URL = EMU_AUTH ? `http://${EMU_AUTH}/securetoken.googleapis.com/v1/token?key=${API_KEY}` : `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`;
var ConfigError = class extends Error {
};
var AccesoError = class extends Error {
};
var LlaveInvalidaError = class extends AccesoError {
};
var ConflictoError = class extends AccesoError {
  constructor(message2, motivo) {
    super(message2);
    this.motivo = motivo;
  }
};
async function canjear(llave) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(llave)}`
  });
  const d = await r.json();
  if (!r.ok || !d.id_token) {
    const codigo = d.error?.message ?? `HTTP ${r.status}`;
    if (codigo.startsWith("TOKEN_EXPIRED") || codigo.startsWith("USER_NOT_FOUND") || codigo.startsWith("INVALID_REFRESH_TOKEN") || codigo.startsWith("INVALID_GRANT_TYPE") || codigo.startsWith("MISSING_REFRESH_TOKEN")) {
      throw new LlaveInvalidaError(
        "El acceso ya no sirve (caduc\xF3 o lo revocaron). Vuelve a conectar el conector desde Claude y entra otra vez con Google."
      );
    }
    if (codigo.startsWith("USER_DISABLED")) {
      throw new LlaveInvalidaError("Esta cuenta est\xE1 deshabilitada.");
    }
    throw new AccesoError(`No se pudo validar la llave: ${codigo}`);
  }
  return {
    idToken: d.id_token,
    uid: d.user_id ?? "",
    expira: Date.now() + Number(d.expires_in ?? 3600) * 1e3
  };
}
async function pedir(url, idToken, toleraFalta = false) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  if (r.status === 404 && toleraFalta) return null;
  revisarRespuesta(r);
  if (!r.ok) throw new AccesoError(`Firestore respondi\xF3 HTTP ${r.status}`);
  return r.json();
}
function revisarRespuesta(r) {
  if (r.status === 401) {
    throw new LlaveInvalidaError(
      "El permiso de la sesi\xF3n venci\xF3 a mitad de la consulta. Vuelve a intentarlo."
    );
  }
  if (r.status === 403) throw new AccesoError("PERMISSION_DENIED");
}
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
function aObjeto(d) {
  const id = d.name.split("/").pop() ?? "";
  return { ...campos(d.fields), id };
}
async function coleccion(nombre, idToken) {
  const salida = [];
  let token = "";
  do {
    const url = `${DOCS}/${nombre}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
    const r = await pedir(url, idToken);
    for (const d of r.documents ?? []) salida.push(aObjeto(d));
    token = r.nextPageToken ?? "";
  } while (token);
  return salida;
}
async function todaLaAsistencia(idToken) {
  const salida = [];
  const TANDA = 1e3;
  let ultimo = null;
  for (; ; ) {
    const structuredQuery = {
      from: [{ collectionId: "attendance", allDescendants: true }],
      orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
      limit: TANDA
    };
    if (ultimo) {
      structuredQuery.startAt = { values: [{ referenceValue: ultimo }], before: false };
    }
    const r = await fetch(`${DOCS}:runQuery`, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery })
    });
    revisarRespuesta(r);
    if (!r.ok) throw new AccesoError(`Firestore respondi\xF3 HTTP ${r.status} al leer la asistencia`);
    const filas = await r.json();
    const docs = filas.map((f) => f.document).filter((d) => !!d);
    for (const d of docs) salida.push(aObjeto(d));
    if (docs.length < TANDA) break;
    ultimo = docs[docs.length - 1].name;
  }
  return salida;
}
async function asistenciasDePersona(memberId, idToken) {
  const r = await fetch(`${DOCS}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "attendance", allDescendants: true }],
        where: {
          fieldFilter: {
            field: { fieldPath: "memberId" },
            op: "EQUAL",
            value: { stringValue: memberId }
          }
        }
      }
    })
  });
  revisarRespuesta(r);
  if (!r.ok) throw new AccesoError(`Firestore respondi\xF3 HTTP ${r.status} al leer el historial`);
  const filas = await r.json();
  return filas.map((f) => f.document).filter((d) => !!d).map((d) => ({
    ruta: d.name.slice(d.name.indexOf("/documents/") + "/documents/".length),
    datos: aObjeto(d)
  }));
}
var TTL_MS = 6e4;
var cache = /* @__PURE__ */ new Map();
function limpiarVencidos() {
  const ahora = Date.now();
  for (const [k, v] of cache) if (v.hasta <= ahora) cache.delete(k);
}
async function abrirSesion(llave) {
  if (!llave || llave.length < 20) {
    throw new ConfigError(
      'Falta entrar con Google. En Claude, toca "Conectar" en este conector y entra con tu cuenta de siempre.'
    );
  }
  limpiarVencidos();
  const cred = await canjear(llave);
  const yo = await pedir(`${DOCS}/users/${cred.uid}`, cred.idToken, true);
  if (!yo) {
    throw new AccesoError(
      "Tu cuenta todav\xEDa no est\xE1 dada de alta en la app. Entra una vez a la app con Google y pide que te aprueben."
    );
  }
  const perfil = campos(yo.fields);
  if (perfil.active === false) {
    throw new AccesoError("Tu acceso est\xE1 desactivado en la app. Habla con la administraci\xF3n.");
  }
  const rol = perfil.role ?? "pending";
  if (rol === "pending") {
    throw new AccesoError("Tu acceso est\xE1 pendiente de aprobaci\xF3n en la app.");
  }
  const esAdmin = rol === "admin" || rol === "super_admin";
  const clave2 = (sufijo) => `${cred.uid}:${sufijo}`;
  async function cacheado(sufijo, cargar) {
    const k = clave2(sufijo);
    const hit = cache.get(k);
    if (hit && hit.hasta > Date.now()) return hit.valor;
    const v = await cargar();
    cache.set(k, { valor: v, hasta: Date.now() + TTL_MS });
    return v;
  }
  return {
    uid: cred.uid,
    email: perfil.email ?? "",
    nombre: perfil.displayName || perfil.email || "Sin nombre",
    rol,
    esAdmin,
    expira: cred.expira,
    cargarSesiones: () => cacheado("sessions", () => coleccion("sessions", cred.idToken)),
    cargarAsistencia: () => cacheado("attendance", () => todaLaAsistencia(cred.idToken)),
    cargarPersonas: () => cacheado("members", async () => {
      const todas = await coleccion("members", cred.idToken);
      return todas.map(({ phone: _p, notes: _n, ...resto }) => resto);
    }),
    async leer(ruta) {
      const d = await pedir(`${DOCS}/${ruta}`, cred.idToken, true);
      return d ? aObjeto(d) : null;
    },
    asistenciaDe: (sessionId) => coleccion(`sessions/${sessionId}/attendance`, cred.idToken),
    asistenciasDePersona: (memberId) => asistenciasDePersona(memberId, cred.idToken),
    async guardar(escrituras) {
      exigirAdmin(esAdmin);
      try {
        await guardarLote(escrituras, cred.idToken);
      } finally {
        olvidar(cred.uid);
      }
    }
  };
}
function aValorRest(v) {
  if (v === null || v === void 0) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(aValorRest) } };
  if (typeof v === "object") {
    const fields = {};
    for (const [k, x] of Object.entries(v)) fields[k] = aValorRest(x);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
var nombreDoc = (ruta) => `${RAIZ_DOCS}/${ruta}`;
var rutaCampo = (campo) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(campo) ? campo : "`" + campo.replace(/[`\\]/g, "\\$&") + "`";
function aEscrituraRest(e) {
  switch (e.tipo) {
    case "crear":
    case "actualizar": {
      const fields = {};
      for (const [k, v] of Object.entries(e.datos)) fields[k] = aValorRest(v);
      return {
        update: { name: nombreDoc(e.ruta), fields },
        // Al crear se escribe el documento entero; al actualizar, SOLO esos
        // campos (lo demás queda como estaba).
        ...e.tipo === "actualizar" ? { updateMask: { fieldPaths: Object.keys(e.datos).map(rutaCampo) } } : {},
        currentDocument: { exists: e.tipo === "actualizar" }
      };
    }
    case "borrar":
      return { delete: nombreDoc(e.ruta), currentDocument: { exists: true } };
    case "sumar":
      return {
        transform: {
          document: nombreDoc(e.ruta),
          fieldTransforms: [
            { fieldPath: rutaCampo(e.campo), increment: { integerValue: String(e.cantidad) } }
          ]
        },
        currentDocument: { exists: true }
      };
  }
}
async function guardarLote(escrituras, idToken) {
  if (escrituras.length === 0) return;
  if (escrituras.length > 500) {
    throw new AccesoError("Son demasiados cambios para hacerlos de una vez (m\xE1s de 500).");
  }
  const r = await fetch(`${DOCS}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes: escrituras.map(aEscrituraRest) })
  });
  if (r.ok) return;
  revisarRespuesta(r);
  let estado = "";
  let detalle = "";
  try {
    const cuerpo = await r.json();
    estado = cuerpo.error?.status ?? "";
    detalle = cuerpo.error?.message ?? "";
  } catch {
  }
  if (r.status === 409 || estado === "ALREADY_EXISTS") {
    throw new ConflictoError("Ya exist\xEDa. No se guard\xF3 nada.", "ya_existe");
  }
  if (r.status === 404 || estado === "NOT_FOUND") {
    throw new ConflictoError("Ya no existe. No se guard\xF3 nada.", "no_existe");
  }
  if (estado === "FAILED_PRECONDITION" && /exist/i.test(detalle)) {
    throw new ConflictoError(
      "Los datos cambiaron mientras tanto. No se guard\xF3 nada.",
      /not exist|no document/i.test(detalle) ? "no_existe" : "ya_existe"
    );
  }
  throw new AccesoError(`No se pudo guardar (HTTP ${r.status}${estado ? ` ${estado}` : ""}).`);
}
function exigirAdmin(esAdmin) {
  if (!esAdmin) {
    throw new AccesoError(
      "Tu cuenta entra como coordinador(a): solo lectura. Registrar o corregir cosas es de administraci\xF3n, y se hace desde la app."
    );
  }
}
function olvidar(uid) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${uid}:`)) cache.delete(k);
}

// mcp/src/escrituras.ts
import { createHash } from "node:crypto";

// src/lib/constants.ts
var SESSION_TYPE_LABELS = {
  entrega_pasos: "Entrega de Pasos",
  reduccion_ego: "Sala de Reducci\xF3n del Ego"
};
var MODALITY_LABELS = {
  virtual: "Virtual",
  presencial: "Presencial"
};
var MODALITIES = ["presencial", "virtual"];
var UNKNOWN_PREFIX = "Por identificar";

// src/lib/normalize.ts
var DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
function normalizeText(input) {
  return (input || "").normalize("NFD").replace(DIACRITICS, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tokenize(input) {
  const n = normalizeText(input);
  return n ? n.split(" ") : [];
}
var CONECTORES = /* @__PURE__ */ new Set(["de", "del", "la", "las", "los", "y", "e", "da", "do", "dos", "van", "von"]);
function tidyName(raw) {
  const limpio = (raw || "").trim().replace(/\s+/g, " ");
  if (limpio.startsWith(UNKNOWN_PREFIX)) return limpio;
  const palabras = limpio.split(" ").filter(Boolean);
  return palabras.map((w, i) => {
    const uniforme = w === w.toLowerCase() || w === w.toUpperCase() && w.length > 1;
    if (!uniforme) return w;
    const lower = w.toLocaleLowerCase("es");
    if (i > 0 && CONECTORES.has(lower)) return lower;
    return lower.replace(new RegExp("(^|-)(\\p{L})", "gu"), (_, sep, c) => sep + c.toLocaleUpperCase("es"));
  }).join(" ");
}
function buildNameParts(fullNameRaw) {
  const fullName = tidyName(fullNameRaw);
  const parts = fullName.split(" ").filter(Boolean);
  const firstName = parts[0] ?? "";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return {
    fullName,
    firstName,
    lastName,
    searchName: normalizeText(fullName)
  };
}

// node_modules/date-fns/toDate.mjs
function toDate(argument) {
  const argStr = Object.prototype.toString.call(argument);
  if (argument instanceof Date || typeof argument === "object" && argStr === "[object Date]") {
    return new argument.constructor(+argument);
  } else if (typeof argument === "number" || argStr === "[object Number]" || typeof argument === "string" || argStr === "[object String]") {
    return new Date(argument);
  } else {
    return /* @__PURE__ */ new Date(NaN);
  }
}

// node_modules/date-fns/constructFrom.mjs
function constructFrom(date, value) {
  if (date instanceof Date) {
    return new date.constructor(value);
  } else {
    return new Date(value);
  }
}

// node_modules/date-fns/constants.mjs
var daysInYear = 365.2425;
var maxTime = Math.pow(10, 8) * 24 * 60 * 60 * 1e3;
var minTime = -maxTime;
var millisecondsInWeek = 6048e5;
var millisecondsInDay = 864e5;
var secondsInHour = 3600;
var secondsInDay = secondsInHour * 24;
var secondsInWeek = secondsInDay * 7;
var secondsInYear = secondsInDay * daysInYear;
var secondsInMonth = secondsInYear / 12;
var secondsInQuarter = secondsInMonth * 3;

// node_modules/date-fns/_lib/defaultOptions.mjs
var defaultOptions = {};
function getDefaultOptions() {
  return defaultOptions;
}

// node_modules/date-fns/startOfWeek.mjs
function startOfWeek(date, options) {
  const defaultOptions2 = getDefaultOptions();
  const weekStartsOn = options?.weekStartsOn ?? options?.locale?.options?.weekStartsOn ?? defaultOptions2.weekStartsOn ?? defaultOptions2.locale?.options?.weekStartsOn ?? 0;
  const _date = toDate(date);
  const day = _date.getDay();
  const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
  _date.setDate(_date.getDate() - diff);
  _date.setHours(0, 0, 0, 0);
  return _date;
}

// node_modules/date-fns/startOfISOWeek.mjs
function startOfISOWeek(date) {
  return startOfWeek(date, { weekStartsOn: 1 });
}

// node_modules/date-fns/getISOWeekYear.mjs
function getISOWeekYear(date) {
  const _date = toDate(date);
  const year = _date.getFullYear();
  const fourthOfJanuaryOfNextYear = constructFrom(date, 0);
  fourthOfJanuaryOfNextYear.setFullYear(year + 1, 0, 4);
  fourthOfJanuaryOfNextYear.setHours(0, 0, 0, 0);
  const startOfNextYear = startOfISOWeek(fourthOfJanuaryOfNextYear);
  const fourthOfJanuaryOfThisYear = constructFrom(date, 0);
  fourthOfJanuaryOfThisYear.setFullYear(year, 0, 4);
  fourthOfJanuaryOfThisYear.setHours(0, 0, 0, 0);
  const startOfThisYear = startOfISOWeek(fourthOfJanuaryOfThisYear);
  if (_date.getTime() >= startOfNextYear.getTime()) {
    return year + 1;
  } else if (_date.getTime() >= startOfThisYear.getTime()) {
    return year;
  } else {
    return year - 1;
  }
}

// node_modules/date-fns/startOfDay.mjs
function startOfDay(date) {
  const _date = toDate(date);
  _date.setHours(0, 0, 0, 0);
  return _date;
}

// node_modules/date-fns/_lib/getTimezoneOffsetInMilliseconds.mjs
function getTimezoneOffsetInMilliseconds(date) {
  const _date = toDate(date);
  const utcDate = new Date(
    Date.UTC(
      _date.getFullYear(),
      _date.getMonth(),
      _date.getDate(),
      _date.getHours(),
      _date.getMinutes(),
      _date.getSeconds(),
      _date.getMilliseconds()
    )
  );
  utcDate.setUTCFullYear(_date.getFullYear());
  return +date - +utcDate;
}

// node_modules/date-fns/differenceInCalendarDays.mjs
function differenceInCalendarDays(dateLeft, dateRight) {
  const startOfDayLeft = startOfDay(dateLeft);
  const startOfDayRight = startOfDay(dateRight);
  const timestampLeft = +startOfDayLeft - getTimezoneOffsetInMilliseconds(startOfDayLeft);
  const timestampRight = +startOfDayRight - getTimezoneOffsetInMilliseconds(startOfDayRight);
  return Math.round((timestampLeft - timestampRight) / millisecondsInDay);
}

// node_modules/date-fns/startOfISOWeekYear.mjs
function startOfISOWeekYear(date) {
  const year = getISOWeekYear(date);
  const fourthOfJanuary = constructFrom(date, 0);
  fourthOfJanuary.setFullYear(year, 0, 4);
  fourthOfJanuary.setHours(0, 0, 0, 0);
  return startOfISOWeek(fourthOfJanuary);
}

// node_modules/date-fns/isDate.mjs
function isDate(value) {
  return value instanceof Date || typeof value === "object" && Object.prototype.toString.call(value) === "[object Date]";
}

// node_modules/date-fns/isValid.mjs
function isValid(date) {
  if (!isDate(date) && typeof date !== "number") {
    return false;
  }
  const _date = toDate(date);
  return !isNaN(Number(_date));
}

// node_modules/date-fns/startOfYear.mjs
function startOfYear(date) {
  const cleanDate = toDate(date);
  const _date = constructFrom(date, 0);
  _date.setFullYear(cleanDate.getFullYear(), 0, 1);
  _date.setHours(0, 0, 0, 0);
  return _date;
}

// node_modules/date-fns/locale/en-US/_lib/formatDistance.mjs
var formatDistanceLocale = {
  lessThanXSeconds: {
    one: "less than a second",
    other: "less than {{count}} seconds"
  },
  xSeconds: {
    one: "1 second",
    other: "{{count}} seconds"
  },
  halfAMinute: "half a minute",
  lessThanXMinutes: {
    one: "less than a minute",
    other: "less than {{count}} minutes"
  },
  xMinutes: {
    one: "1 minute",
    other: "{{count}} minutes"
  },
  aboutXHours: {
    one: "about 1 hour",
    other: "about {{count}} hours"
  },
  xHours: {
    one: "1 hour",
    other: "{{count}} hours"
  },
  xDays: {
    one: "1 day",
    other: "{{count}} days"
  },
  aboutXWeeks: {
    one: "about 1 week",
    other: "about {{count}} weeks"
  },
  xWeeks: {
    one: "1 week",
    other: "{{count}} weeks"
  },
  aboutXMonths: {
    one: "about 1 month",
    other: "about {{count}} months"
  },
  xMonths: {
    one: "1 month",
    other: "{{count}} months"
  },
  aboutXYears: {
    one: "about 1 year",
    other: "about {{count}} years"
  },
  xYears: {
    one: "1 year",
    other: "{{count}} years"
  },
  overXYears: {
    one: "over 1 year",
    other: "over {{count}} years"
  },
  almostXYears: {
    one: "almost 1 year",
    other: "almost {{count}} years"
  }
};
var formatDistance = (token, count, options) => {
  let result;
  const tokenValue = formatDistanceLocale[token];
  if (typeof tokenValue === "string") {
    result = tokenValue;
  } else if (count === 1) {
    result = tokenValue.one;
  } else {
    result = tokenValue.other.replace("{{count}}", count.toString());
  }
  if (options?.addSuffix) {
    if (options.comparison && options.comparison > 0) {
      return "in " + result;
    } else {
      return result + " ago";
    }
  }
  return result;
};

// node_modules/date-fns/locale/_lib/buildFormatLongFn.mjs
function buildFormatLongFn(args) {
  return (options = {}) => {
    const width = options.width ? String(options.width) : args.defaultWidth;
    const format3 = args.formats[width] || args.formats[args.defaultWidth];
    return format3;
  };
}

// node_modules/date-fns/locale/en-US/_lib/formatLong.mjs
var dateFormats = {
  full: "EEEE, MMMM do, y",
  long: "MMMM do, y",
  medium: "MMM d, y",
  short: "MM/dd/yyyy"
};
var timeFormats = {
  full: "h:mm:ss a zzzz",
  long: "h:mm:ss a z",
  medium: "h:mm:ss a",
  short: "h:mm a"
};
var dateTimeFormats = {
  full: "{{date}} 'at' {{time}}",
  long: "{{date}} 'at' {{time}}",
  medium: "{{date}}, {{time}}",
  short: "{{date}}, {{time}}"
};
var formatLong = {
  date: buildFormatLongFn({
    formats: dateFormats,
    defaultWidth: "full"
  }),
  time: buildFormatLongFn({
    formats: timeFormats,
    defaultWidth: "full"
  }),
  dateTime: buildFormatLongFn({
    formats: dateTimeFormats,
    defaultWidth: "full"
  })
};

// node_modules/date-fns/locale/en-US/_lib/formatRelative.mjs
var formatRelativeLocale = {
  lastWeek: "'last' eeee 'at' p",
  yesterday: "'yesterday at' p",
  today: "'today at' p",
  tomorrow: "'tomorrow at' p",
  nextWeek: "eeee 'at' p",
  other: "P"
};
var formatRelative = (token, _date, _baseDate, _options) => formatRelativeLocale[token];

// node_modules/date-fns/locale/_lib/buildLocalizeFn.mjs
function buildLocalizeFn(args) {
  return (value, options) => {
    const context = options?.context ? String(options.context) : "standalone";
    let valuesArray;
    if (context === "formatting" && args.formattingValues) {
      const defaultWidth = args.defaultFormattingWidth || args.defaultWidth;
      const width = options?.width ? String(options.width) : defaultWidth;
      valuesArray = args.formattingValues[width] || args.formattingValues[defaultWidth];
    } else {
      const defaultWidth = args.defaultWidth;
      const width = options?.width ? String(options.width) : args.defaultWidth;
      valuesArray = args.values[width] || args.values[defaultWidth];
    }
    const index = args.argumentCallback ? args.argumentCallback(value) : value;
    return valuesArray[index];
  };
}

// node_modules/date-fns/locale/en-US/_lib/localize.mjs
var eraValues = {
  narrow: ["B", "A"],
  abbreviated: ["BC", "AD"],
  wide: ["Before Christ", "Anno Domini"]
};
var quarterValues = {
  narrow: ["1", "2", "3", "4"],
  abbreviated: ["Q1", "Q2", "Q3", "Q4"],
  wide: ["1st quarter", "2nd quarter", "3rd quarter", "4th quarter"]
};
var monthValues = {
  narrow: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"],
  abbreviated: [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ],
  wide: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ]
};
var dayValues = {
  narrow: ["S", "M", "T", "W", "T", "F", "S"],
  short: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  abbreviated: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  wide: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
  ]
};
var dayPeriodValues = {
  narrow: {
    am: "a",
    pm: "p",
    midnight: "mi",
    noon: "n",
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    night: "night"
  },
  abbreviated: {
    am: "AM",
    pm: "PM",
    midnight: "midnight",
    noon: "noon",
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    night: "night"
  },
  wide: {
    am: "a.m.",
    pm: "p.m.",
    midnight: "midnight",
    noon: "noon",
    morning: "morning",
    afternoon: "afternoon",
    evening: "evening",
    night: "night"
  }
};
var formattingDayPeriodValues = {
  narrow: {
    am: "a",
    pm: "p",
    midnight: "mi",
    noon: "n",
    morning: "in the morning",
    afternoon: "in the afternoon",
    evening: "in the evening",
    night: "at night"
  },
  abbreviated: {
    am: "AM",
    pm: "PM",
    midnight: "midnight",
    noon: "noon",
    morning: "in the morning",
    afternoon: "in the afternoon",
    evening: "in the evening",
    night: "at night"
  },
  wide: {
    am: "a.m.",
    pm: "p.m.",
    midnight: "midnight",
    noon: "noon",
    morning: "in the morning",
    afternoon: "in the afternoon",
    evening: "in the evening",
    night: "at night"
  }
};
var ordinalNumber = (dirtyNumber, _options) => {
  const number = Number(dirtyNumber);
  const rem100 = number % 100;
  if (rem100 > 20 || rem100 < 10) {
    switch (rem100 % 10) {
      case 1:
        return number + "st";
      case 2:
        return number + "nd";
      case 3:
        return number + "rd";
    }
  }
  return number + "th";
};
var localize = {
  ordinalNumber,
  era: buildLocalizeFn({
    values: eraValues,
    defaultWidth: "wide"
  }),
  quarter: buildLocalizeFn({
    values: quarterValues,
    defaultWidth: "wide",
    argumentCallback: (quarter) => quarter - 1
  }),
  month: buildLocalizeFn({
    values: monthValues,
    defaultWidth: "wide"
  }),
  day: buildLocalizeFn({
    values: dayValues,
    defaultWidth: "wide"
  }),
  dayPeriod: buildLocalizeFn({
    values: dayPeriodValues,
    defaultWidth: "wide",
    formattingValues: formattingDayPeriodValues,
    defaultFormattingWidth: "wide"
  })
};

// node_modules/date-fns/locale/_lib/buildMatchFn.mjs
function buildMatchFn(args) {
  return (string, options = {}) => {
    const width = options.width;
    const matchPattern = width && args.matchPatterns[width] || args.matchPatterns[args.defaultMatchWidth];
    const matchResult = string.match(matchPattern);
    if (!matchResult) {
      return null;
    }
    const matchedString = matchResult[0];
    const parsePatterns = width && args.parsePatterns[width] || args.parsePatterns[args.defaultParseWidth];
    const key = Array.isArray(parsePatterns) ? findIndex(parsePatterns, (pattern) => pattern.test(matchedString)) : (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- I challange you to fix the type
      findKey(parsePatterns, (pattern) => pattern.test(matchedString))
    );
    let value;
    value = args.valueCallback ? args.valueCallback(key) : key;
    value = options.valueCallback ? (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- I challange you to fix the type
      options.valueCallback(value)
    ) : value;
    const rest = string.slice(matchedString.length);
    return { value, rest };
  };
}
function findKey(object, predicate) {
  for (const key in object) {
    if (Object.prototype.hasOwnProperty.call(object, key) && predicate(object[key])) {
      return key;
    }
  }
  return void 0;
}
function findIndex(array, predicate) {
  for (let key = 0; key < array.length; key++) {
    if (predicate(array[key])) {
      return key;
    }
  }
  return void 0;
}

// node_modules/date-fns/locale/_lib/buildMatchPatternFn.mjs
function buildMatchPatternFn(args) {
  return (string, options = {}) => {
    const matchResult = string.match(args.matchPattern);
    if (!matchResult) return null;
    const matchedString = matchResult[0];
    const parseResult = string.match(args.parsePattern);
    if (!parseResult) return null;
    let value = args.valueCallback ? args.valueCallback(parseResult[0]) : parseResult[0];
    value = options.valueCallback ? options.valueCallback(value) : value;
    const rest = string.slice(matchedString.length);
    return { value, rest };
  };
}

// node_modules/date-fns/locale/en-US/_lib/match.mjs
var matchOrdinalNumberPattern = /^(\d+)(th|st|nd|rd)?/i;
var parseOrdinalNumberPattern = /\d+/i;
var matchEraPatterns = {
  narrow: /^(b|a)/i,
  abbreviated: /^(b\.?\s?c\.?|b\.?\s?c\.?\s?e\.?|a\.?\s?d\.?|c\.?\s?e\.?)/i,
  wide: /^(before christ|before common era|anno domini|common era)/i
};
var parseEraPatterns = {
  any: [/^b/i, /^(a|c)/i]
};
var matchQuarterPatterns = {
  narrow: /^[1234]/i,
  abbreviated: /^q[1234]/i,
  wide: /^[1234](th|st|nd|rd)? quarter/i
};
var parseQuarterPatterns = {
  any: [/1/i, /2/i, /3/i, /4/i]
};
var matchMonthPatterns = {
  narrow: /^[jfmasond]/i,
  abbreviated: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  wide: /^(january|february|march|april|may|june|july|august|september|october|november|december)/i
};
var parseMonthPatterns = {
  narrow: [
    /^j/i,
    /^f/i,
    /^m/i,
    /^a/i,
    /^m/i,
    /^j/i,
    /^j/i,
    /^a/i,
    /^s/i,
    /^o/i,
    /^n/i,
    /^d/i
  ],
  any: [
    /^ja/i,
    /^f/i,
    /^mar/i,
    /^ap/i,
    /^may/i,
    /^jun/i,
    /^jul/i,
    /^au/i,
    /^s/i,
    /^o/i,
    /^n/i,
    /^d/i
  ]
};
var matchDayPatterns = {
  narrow: /^[smtwf]/i,
  short: /^(su|mo|tu|we|th|fr|sa)/i,
  abbreviated: /^(sun|mon|tue|wed|thu|fri|sat)/i,
  wide: /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i
};
var parseDayPatterns = {
  narrow: [/^s/i, /^m/i, /^t/i, /^w/i, /^t/i, /^f/i, /^s/i],
  any: [/^su/i, /^m/i, /^tu/i, /^w/i, /^th/i, /^f/i, /^sa/i]
};
var matchDayPeriodPatterns = {
  narrow: /^(a|p|mi|n|(in the|at) (morning|afternoon|evening|night))/i,
  any: /^([ap]\.?\s?m\.?|midnight|noon|(in the|at) (morning|afternoon|evening|night))/i
};
var parseDayPeriodPatterns = {
  any: {
    am: /^a/i,
    pm: /^p/i,
    midnight: /^mi/i,
    noon: /^no/i,
    morning: /morning/i,
    afternoon: /afternoon/i,
    evening: /evening/i,
    night: /night/i
  }
};
var match = {
  ordinalNumber: buildMatchPatternFn({
    matchPattern: matchOrdinalNumberPattern,
    parsePattern: parseOrdinalNumberPattern,
    valueCallback: (value) => parseInt(value, 10)
  }),
  era: buildMatchFn({
    matchPatterns: matchEraPatterns,
    defaultMatchWidth: "wide",
    parsePatterns: parseEraPatterns,
    defaultParseWidth: "any"
  }),
  quarter: buildMatchFn({
    matchPatterns: matchQuarterPatterns,
    defaultMatchWidth: "wide",
    parsePatterns: parseQuarterPatterns,
    defaultParseWidth: "any",
    valueCallback: (index) => index + 1
  }),
  month: buildMatchFn({
    matchPatterns: matchMonthPatterns,
    defaultMatchWidth: "wide",
    parsePatterns: parseMonthPatterns,
    defaultParseWidth: "any"
  }),
  day: buildMatchFn({
    matchPatterns: matchDayPatterns,
    defaultMatchWidth: "wide",
    parsePatterns: parseDayPatterns,
    defaultParseWidth: "any"
  }),
  dayPeriod: buildMatchFn({
    matchPatterns: matchDayPeriodPatterns,
    defaultMatchWidth: "any",
    parsePatterns: parseDayPeriodPatterns,
    defaultParseWidth: "any"
  })
};

// node_modules/date-fns/locale/en-US.mjs
var enUS = {
  code: "en-US",
  formatDistance,
  formatLong,
  formatRelative,
  localize,
  match,
  options: {
    weekStartsOn: 0,
    firstWeekContainsDate: 1
  }
};

// node_modules/date-fns/getDayOfYear.mjs
function getDayOfYear(date) {
  const _date = toDate(date);
  const diff = differenceInCalendarDays(_date, startOfYear(_date));
  const dayOfYear = diff + 1;
  return dayOfYear;
}

// node_modules/date-fns/getISOWeek.mjs
function getISOWeek(date) {
  const _date = toDate(date);
  const diff = +startOfISOWeek(_date) - +startOfISOWeekYear(_date);
  return Math.round(diff / millisecondsInWeek) + 1;
}

// node_modules/date-fns/getWeekYear.mjs
function getWeekYear(date, options) {
  const _date = toDate(date);
  const year = _date.getFullYear();
  const defaultOptions2 = getDefaultOptions();
  const firstWeekContainsDate = options?.firstWeekContainsDate ?? options?.locale?.options?.firstWeekContainsDate ?? defaultOptions2.firstWeekContainsDate ?? defaultOptions2.locale?.options?.firstWeekContainsDate ?? 1;
  const firstWeekOfNextYear = constructFrom(date, 0);
  firstWeekOfNextYear.setFullYear(year + 1, 0, firstWeekContainsDate);
  firstWeekOfNextYear.setHours(0, 0, 0, 0);
  const startOfNextYear = startOfWeek(firstWeekOfNextYear, options);
  const firstWeekOfThisYear = constructFrom(date, 0);
  firstWeekOfThisYear.setFullYear(year, 0, firstWeekContainsDate);
  firstWeekOfThisYear.setHours(0, 0, 0, 0);
  const startOfThisYear = startOfWeek(firstWeekOfThisYear, options);
  if (_date.getTime() >= startOfNextYear.getTime()) {
    return year + 1;
  } else if (_date.getTime() >= startOfThisYear.getTime()) {
    return year;
  } else {
    return year - 1;
  }
}

// node_modules/date-fns/startOfWeekYear.mjs
function startOfWeekYear(date, options) {
  const defaultOptions2 = getDefaultOptions();
  const firstWeekContainsDate = options?.firstWeekContainsDate ?? options?.locale?.options?.firstWeekContainsDate ?? defaultOptions2.firstWeekContainsDate ?? defaultOptions2.locale?.options?.firstWeekContainsDate ?? 1;
  const year = getWeekYear(date, options);
  const firstWeek = constructFrom(date, 0);
  firstWeek.setFullYear(year, 0, firstWeekContainsDate);
  firstWeek.setHours(0, 0, 0, 0);
  const _date = startOfWeek(firstWeek, options);
  return _date;
}

// node_modules/date-fns/getWeek.mjs
function getWeek(date, options) {
  const _date = toDate(date);
  const diff = +startOfWeek(_date, options) - +startOfWeekYear(_date, options);
  return Math.round(diff / millisecondsInWeek) + 1;
}

// node_modules/date-fns/_lib/addLeadingZeros.mjs
function addLeadingZeros(number, targetLength) {
  const sign = number < 0 ? "-" : "";
  const output = Math.abs(number).toString().padStart(targetLength, "0");
  return sign + output;
}

// node_modules/date-fns/_lib/format/lightFormatters.mjs
var lightFormatters = {
  // Year
  y(date, token) {
    const signedYear = date.getFullYear();
    const year = signedYear > 0 ? signedYear : 1 - signedYear;
    return addLeadingZeros(token === "yy" ? year % 100 : year, token.length);
  },
  // Month
  M(date, token) {
    const month = date.getMonth();
    return token === "M" ? String(month + 1) : addLeadingZeros(month + 1, 2);
  },
  // Day of the month
  d(date, token) {
    return addLeadingZeros(date.getDate(), token.length);
  },
  // AM or PM
  a(date, token) {
    const dayPeriodEnumValue = date.getHours() / 12 >= 1 ? "pm" : "am";
    switch (token) {
      case "a":
      case "aa":
        return dayPeriodEnumValue.toUpperCase();
      case "aaa":
        return dayPeriodEnumValue;
      case "aaaaa":
        return dayPeriodEnumValue[0];
      case "aaaa":
      default:
        return dayPeriodEnumValue === "am" ? "a.m." : "p.m.";
    }
  },
  // Hour [1-12]
  h(date, token) {
    return addLeadingZeros(date.getHours() % 12 || 12, token.length);
  },
  // Hour [0-23]
  H(date, token) {
    return addLeadingZeros(date.getHours(), token.length);
  },
  // Minute
  m(date, token) {
    return addLeadingZeros(date.getMinutes(), token.length);
  },
  // Second
  s(date, token) {
    return addLeadingZeros(date.getSeconds(), token.length);
  },
  // Fraction of second
  S(date, token) {
    const numberOfDigits = token.length;
    const milliseconds = date.getMilliseconds();
    const fractionalSeconds = Math.trunc(
      milliseconds * Math.pow(10, numberOfDigits - 3)
    );
    return addLeadingZeros(fractionalSeconds, token.length);
  }
};

// node_modules/date-fns/_lib/format/formatters.mjs
var dayPeriodEnum = {
  am: "am",
  pm: "pm",
  midnight: "midnight",
  noon: "noon",
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
  night: "night"
};
var formatters = {
  // Era
  G: function(date, token, localize3) {
    const era = date.getFullYear() > 0 ? 1 : 0;
    switch (token) {
      // AD, BC
      case "G":
      case "GG":
      case "GGG":
        return localize3.era(era, { width: "abbreviated" });
      // A, B
      case "GGGGG":
        return localize3.era(era, { width: "narrow" });
      // Anno Domini, Before Christ
      case "GGGG":
      default:
        return localize3.era(era, { width: "wide" });
    }
  },
  // Year
  y: function(date, token, localize3) {
    if (token === "yo") {
      const signedYear = date.getFullYear();
      const year = signedYear > 0 ? signedYear : 1 - signedYear;
      return localize3.ordinalNumber(year, { unit: "year" });
    }
    return lightFormatters.y(date, token);
  },
  // Local week-numbering year
  Y: function(date, token, localize3, options) {
    const signedWeekYear = getWeekYear(date, options);
    const weekYear = signedWeekYear > 0 ? signedWeekYear : 1 - signedWeekYear;
    if (token === "YY") {
      const twoDigitYear = weekYear % 100;
      return addLeadingZeros(twoDigitYear, 2);
    }
    if (token === "Yo") {
      return localize3.ordinalNumber(weekYear, { unit: "year" });
    }
    return addLeadingZeros(weekYear, token.length);
  },
  // ISO week-numbering year
  R: function(date, token) {
    const isoWeekYear = getISOWeekYear(date);
    return addLeadingZeros(isoWeekYear, token.length);
  },
  // Extended year. This is a single number designating the year of this calendar system.
  // The main difference between `y` and `u` localizers are B.C. years:
  // | Year | `y` | `u` |
  // |------|-----|-----|
  // | AC 1 |   1 |   1 |
  // | BC 1 |   1 |   0 |
  // | BC 2 |   2 |  -1 |
  // Also `yy` always returns the last two digits of a year,
  // while `uu` pads single digit years to 2 characters and returns other years unchanged.
  u: function(date, token) {
    const year = date.getFullYear();
    return addLeadingZeros(year, token.length);
  },
  // Quarter
  Q: function(date, token, localize3) {
    const quarter = Math.ceil((date.getMonth() + 1) / 3);
    switch (token) {
      // 1, 2, 3, 4
      case "Q":
        return String(quarter);
      // 01, 02, 03, 04
      case "QQ":
        return addLeadingZeros(quarter, 2);
      // 1st, 2nd, 3rd, 4th
      case "Qo":
        return localize3.ordinalNumber(quarter, { unit: "quarter" });
      // Q1, Q2, Q3, Q4
      case "QQQ":
        return localize3.quarter(quarter, {
          width: "abbreviated",
          context: "formatting"
        });
      // 1, 2, 3, 4 (narrow quarter; could be not numerical)
      case "QQQQQ":
        return localize3.quarter(quarter, {
          width: "narrow",
          context: "formatting"
        });
      // 1st quarter, 2nd quarter, ...
      case "QQQQ":
      default:
        return localize3.quarter(quarter, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Stand-alone quarter
  q: function(date, token, localize3) {
    const quarter = Math.ceil((date.getMonth() + 1) / 3);
    switch (token) {
      // 1, 2, 3, 4
      case "q":
        return String(quarter);
      // 01, 02, 03, 04
      case "qq":
        return addLeadingZeros(quarter, 2);
      // 1st, 2nd, 3rd, 4th
      case "qo":
        return localize3.ordinalNumber(quarter, { unit: "quarter" });
      // Q1, Q2, Q3, Q4
      case "qqq":
        return localize3.quarter(quarter, {
          width: "abbreviated",
          context: "standalone"
        });
      // 1, 2, 3, 4 (narrow quarter; could be not numerical)
      case "qqqqq":
        return localize3.quarter(quarter, {
          width: "narrow",
          context: "standalone"
        });
      // 1st quarter, 2nd quarter, ...
      case "qqqq":
      default:
        return localize3.quarter(quarter, {
          width: "wide",
          context: "standalone"
        });
    }
  },
  // Month
  M: function(date, token, localize3) {
    const month = date.getMonth();
    switch (token) {
      case "M":
      case "MM":
        return lightFormatters.M(date, token);
      // 1st, 2nd, ..., 12th
      case "Mo":
        return localize3.ordinalNumber(month + 1, { unit: "month" });
      // Jan, Feb, ..., Dec
      case "MMM":
        return localize3.month(month, {
          width: "abbreviated",
          context: "formatting"
        });
      // J, F, ..., D
      case "MMMMM":
        return localize3.month(month, {
          width: "narrow",
          context: "formatting"
        });
      // January, February, ..., December
      case "MMMM":
      default:
        return localize3.month(month, { width: "wide", context: "formatting" });
    }
  },
  // Stand-alone month
  L: function(date, token, localize3) {
    const month = date.getMonth();
    switch (token) {
      // 1, 2, ..., 12
      case "L":
        return String(month + 1);
      // 01, 02, ..., 12
      case "LL":
        return addLeadingZeros(month + 1, 2);
      // 1st, 2nd, ..., 12th
      case "Lo":
        return localize3.ordinalNumber(month + 1, { unit: "month" });
      // Jan, Feb, ..., Dec
      case "LLL":
        return localize3.month(month, {
          width: "abbreviated",
          context: "standalone"
        });
      // J, F, ..., D
      case "LLLLL":
        return localize3.month(month, {
          width: "narrow",
          context: "standalone"
        });
      // January, February, ..., December
      case "LLLL":
      default:
        return localize3.month(month, { width: "wide", context: "standalone" });
    }
  },
  // Local week of year
  w: function(date, token, localize3, options) {
    const week = getWeek(date, options);
    if (token === "wo") {
      return localize3.ordinalNumber(week, { unit: "week" });
    }
    return addLeadingZeros(week, token.length);
  },
  // ISO week of year
  I: function(date, token, localize3) {
    const isoWeek = getISOWeek(date);
    if (token === "Io") {
      return localize3.ordinalNumber(isoWeek, { unit: "week" });
    }
    return addLeadingZeros(isoWeek, token.length);
  },
  // Day of the month
  d: function(date, token, localize3) {
    if (token === "do") {
      return localize3.ordinalNumber(date.getDate(), { unit: "date" });
    }
    return lightFormatters.d(date, token);
  },
  // Day of year
  D: function(date, token, localize3) {
    const dayOfYear = getDayOfYear(date);
    if (token === "Do") {
      return localize3.ordinalNumber(dayOfYear, { unit: "dayOfYear" });
    }
    return addLeadingZeros(dayOfYear, token.length);
  },
  // Day of week
  E: function(date, token, localize3) {
    const dayOfWeek = date.getDay();
    switch (token) {
      // Tue
      case "E":
      case "EE":
      case "EEE":
        return localize3.day(dayOfWeek, {
          width: "abbreviated",
          context: "formatting"
        });
      // T
      case "EEEEE":
        return localize3.day(dayOfWeek, {
          width: "narrow",
          context: "formatting"
        });
      // Tu
      case "EEEEEE":
        return localize3.day(dayOfWeek, {
          width: "short",
          context: "formatting"
        });
      // Tuesday
      case "EEEE":
      default:
        return localize3.day(dayOfWeek, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Local day of week
  e: function(date, token, localize3, options) {
    const dayOfWeek = date.getDay();
    const localDayOfWeek = (dayOfWeek - options.weekStartsOn + 8) % 7 || 7;
    switch (token) {
      // Numerical value (Nth day of week with current locale or weekStartsOn)
      case "e":
        return String(localDayOfWeek);
      // Padded numerical value
      case "ee":
        return addLeadingZeros(localDayOfWeek, 2);
      // 1st, 2nd, ..., 7th
      case "eo":
        return localize3.ordinalNumber(localDayOfWeek, { unit: "day" });
      case "eee":
        return localize3.day(dayOfWeek, {
          width: "abbreviated",
          context: "formatting"
        });
      // T
      case "eeeee":
        return localize3.day(dayOfWeek, {
          width: "narrow",
          context: "formatting"
        });
      // Tu
      case "eeeeee":
        return localize3.day(dayOfWeek, {
          width: "short",
          context: "formatting"
        });
      // Tuesday
      case "eeee":
      default:
        return localize3.day(dayOfWeek, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Stand-alone local day of week
  c: function(date, token, localize3, options) {
    const dayOfWeek = date.getDay();
    const localDayOfWeek = (dayOfWeek - options.weekStartsOn + 8) % 7 || 7;
    switch (token) {
      // Numerical value (same as in `e`)
      case "c":
        return String(localDayOfWeek);
      // Padded numerical value
      case "cc":
        return addLeadingZeros(localDayOfWeek, token.length);
      // 1st, 2nd, ..., 7th
      case "co":
        return localize3.ordinalNumber(localDayOfWeek, { unit: "day" });
      case "ccc":
        return localize3.day(dayOfWeek, {
          width: "abbreviated",
          context: "standalone"
        });
      // T
      case "ccccc":
        return localize3.day(dayOfWeek, {
          width: "narrow",
          context: "standalone"
        });
      // Tu
      case "cccccc":
        return localize3.day(dayOfWeek, {
          width: "short",
          context: "standalone"
        });
      // Tuesday
      case "cccc":
      default:
        return localize3.day(dayOfWeek, {
          width: "wide",
          context: "standalone"
        });
    }
  },
  // ISO day of week
  i: function(date, token, localize3) {
    const dayOfWeek = date.getDay();
    const isoDayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek;
    switch (token) {
      // 2
      case "i":
        return String(isoDayOfWeek);
      // 02
      case "ii":
        return addLeadingZeros(isoDayOfWeek, token.length);
      // 2nd
      case "io":
        return localize3.ordinalNumber(isoDayOfWeek, { unit: "day" });
      // Tue
      case "iii":
        return localize3.day(dayOfWeek, {
          width: "abbreviated",
          context: "formatting"
        });
      // T
      case "iiiii":
        return localize3.day(dayOfWeek, {
          width: "narrow",
          context: "formatting"
        });
      // Tu
      case "iiiiii":
        return localize3.day(dayOfWeek, {
          width: "short",
          context: "formatting"
        });
      // Tuesday
      case "iiii":
      default:
        return localize3.day(dayOfWeek, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // AM or PM
  a: function(date, token, localize3) {
    const hours = date.getHours();
    const dayPeriodEnumValue = hours / 12 >= 1 ? "pm" : "am";
    switch (token) {
      case "a":
      case "aa":
        return localize3.dayPeriod(dayPeriodEnumValue, {
          width: "abbreviated",
          context: "formatting"
        });
      case "aaa":
        return localize3.dayPeriod(dayPeriodEnumValue, {
          width: "abbreviated",
          context: "formatting"
        }).toLowerCase();
      case "aaaaa":
        return localize3.dayPeriod(dayPeriodEnumValue, {
          width: "narrow",
          context: "formatting"
        });
      case "aaaa":
      default:
        return localize3.dayPeriod(dayPeriodEnumValue, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // AM, PM, midnight, noon
  b: function(date, token, localize3) {
    const hours = date.getHours();
    let dayPeriodEnumValue;
    if (hours === 12) {
      dayPeriodEnumValue = dayPeriodEnum.noon;
    } else if (hours === 0) {
      dayPeriodEnumValue = dayPeriodEnum.midnight;
    } else {
      dayPeriodEnumValue = hours / 12 >= 1 ? "pm" : "am";
    }
    switch (token) {
      case "b":
      case "bb":
        return localize3.dayPeriod(dayPeriodEnumValue, {
          width: "abbreviated",
          context: "formatting"
        });
      case "bbb":
        return localize3.dayPeriod(dayPeriodEnumValue, {
          width: "abbreviated",
          context: "formatting"
        }).toLowerCase();
      case "bbbbb":
        return localize3.dayPeriod(dayPeriodEnumValue, {
          width: "narrow",
          context: "formatting"
        });
      case "bbbb":
      default:
        return localize3.dayPeriod(dayPeriodEnumValue, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // in the morning, in the afternoon, in the evening, at night
  B: function(date, token, localize3) {
    const hours = date.getHours();
    let dayPeriodEnumValue;
    if (hours >= 17) {
      dayPeriodEnumValue = dayPeriodEnum.evening;
    } else if (hours >= 12) {
      dayPeriodEnumValue = dayPeriodEnum.afternoon;
    } else if (hours >= 4) {
      dayPeriodEnumValue = dayPeriodEnum.morning;
    } else {
      dayPeriodEnumValue = dayPeriodEnum.night;
    }
    switch (token) {
      case "B":
      case "BB":
      case "BBB":
        return localize3.dayPeriod(dayPeriodEnumValue, {
          width: "abbreviated",
          context: "formatting"
        });
      case "BBBBB":
        return localize3.dayPeriod(dayPeriodEnumValue, {
          width: "narrow",
          context: "formatting"
        });
      case "BBBB":
      default:
        return localize3.dayPeriod(dayPeriodEnumValue, {
          width: "wide",
          context: "formatting"
        });
    }
  },
  // Hour [1-12]
  h: function(date, token, localize3) {
    if (token === "ho") {
      let hours = date.getHours() % 12;
      if (hours === 0) hours = 12;
      return localize3.ordinalNumber(hours, { unit: "hour" });
    }
    return lightFormatters.h(date, token);
  },
  // Hour [0-23]
  H: function(date, token, localize3) {
    if (token === "Ho") {
      return localize3.ordinalNumber(date.getHours(), { unit: "hour" });
    }
    return lightFormatters.H(date, token);
  },
  // Hour [0-11]
  K: function(date, token, localize3) {
    const hours = date.getHours() % 12;
    if (token === "Ko") {
      return localize3.ordinalNumber(hours, { unit: "hour" });
    }
    return addLeadingZeros(hours, token.length);
  },
  // Hour [1-24]
  k: function(date, token, localize3) {
    let hours = date.getHours();
    if (hours === 0) hours = 24;
    if (token === "ko") {
      return localize3.ordinalNumber(hours, { unit: "hour" });
    }
    return addLeadingZeros(hours, token.length);
  },
  // Minute
  m: function(date, token, localize3) {
    if (token === "mo") {
      return localize3.ordinalNumber(date.getMinutes(), { unit: "minute" });
    }
    return lightFormatters.m(date, token);
  },
  // Second
  s: function(date, token, localize3) {
    if (token === "so") {
      return localize3.ordinalNumber(date.getSeconds(), { unit: "second" });
    }
    return lightFormatters.s(date, token);
  },
  // Fraction of second
  S: function(date, token) {
    return lightFormatters.S(date, token);
  },
  // Timezone (ISO-8601. If offset is 0, output is always `'Z'`)
  X: function(date, token, _localize) {
    const timezoneOffset = date.getTimezoneOffset();
    if (timezoneOffset === 0) {
      return "Z";
    }
    switch (token) {
      // Hours and optional minutes
      case "X":
        return formatTimezoneWithOptionalMinutes(timezoneOffset);
      // Hours, minutes and optional seconds without `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `XX`
      case "XXXX":
      case "XX":
        return formatTimezone(timezoneOffset);
      // Hours, minutes and optional seconds with `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `XXX`
      case "XXXXX":
      case "XXX":
      // Hours and minutes with `:` delimiter
      default:
        return formatTimezone(timezoneOffset, ":");
    }
  },
  // Timezone (ISO-8601. If offset is 0, output is `'+00:00'` or equivalent)
  x: function(date, token, _localize) {
    const timezoneOffset = date.getTimezoneOffset();
    switch (token) {
      // Hours and optional minutes
      case "x":
        return formatTimezoneWithOptionalMinutes(timezoneOffset);
      // Hours, minutes and optional seconds without `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `xx`
      case "xxxx":
      case "xx":
        return formatTimezone(timezoneOffset);
      // Hours, minutes and optional seconds with `:` delimiter
      // Note: neither ISO-8601 nor JavaScript supports seconds in timezone offsets
      // so this token always has the same output as `xxx`
      case "xxxxx":
      case "xxx":
      // Hours and minutes with `:` delimiter
      default:
        return formatTimezone(timezoneOffset, ":");
    }
  },
  // Timezone (GMT)
  O: function(date, token, _localize) {
    const timezoneOffset = date.getTimezoneOffset();
    switch (token) {
      // Short
      case "O":
      case "OO":
      case "OOO":
        return "GMT" + formatTimezoneShort(timezoneOffset, ":");
      // Long
      case "OOOO":
      default:
        return "GMT" + formatTimezone(timezoneOffset, ":");
    }
  },
  // Timezone (specific non-location)
  z: function(date, token, _localize) {
    const timezoneOffset = date.getTimezoneOffset();
    switch (token) {
      // Short
      case "z":
      case "zz":
      case "zzz":
        return "GMT" + formatTimezoneShort(timezoneOffset, ":");
      // Long
      case "zzzz":
      default:
        return "GMT" + formatTimezone(timezoneOffset, ":");
    }
  },
  // Seconds timestamp
  t: function(date, token, _localize) {
    const timestamp = Math.trunc(date.getTime() / 1e3);
    return addLeadingZeros(timestamp, token.length);
  },
  // Milliseconds timestamp
  T: function(date, token, _localize) {
    const timestamp = date.getTime();
    return addLeadingZeros(timestamp, token.length);
  }
};
function formatTimezoneShort(offset, delimiter = "") {
  const sign = offset > 0 ? "-" : "+";
  const absOffset = Math.abs(offset);
  const hours = Math.trunc(absOffset / 60);
  const minutes = absOffset % 60;
  if (minutes === 0) {
    return sign + String(hours);
  }
  return sign + String(hours) + delimiter + addLeadingZeros(minutes, 2);
}
function formatTimezoneWithOptionalMinutes(offset, delimiter) {
  if (offset % 60 === 0) {
    const sign = offset > 0 ? "-" : "+";
    return sign + addLeadingZeros(Math.abs(offset) / 60, 2);
  }
  return formatTimezone(offset, delimiter);
}
function formatTimezone(offset, delimiter = "") {
  const sign = offset > 0 ? "-" : "+";
  const absOffset = Math.abs(offset);
  const hours = addLeadingZeros(Math.trunc(absOffset / 60), 2);
  const minutes = addLeadingZeros(absOffset % 60, 2);
  return sign + hours + delimiter + minutes;
}

// node_modules/date-fns/_lib/format/longFormatters.mjs
var dateLongFormatter = (pattern, formatLong3) => {
  switch (pattern) {
    case "P":
      return formatLong3.date({ width: "short" });
    case "PP":
      return formatLong3.date({ width: "medium" });
    case "PPP":
      return formatLong3.date({ width: "long" });
    case "PPPP":
    default:
      return formatLong3.date({ width: "full" });
  }
};
var timeLongFormatter = (pattern, formatLong3) => {
  switch (pattern) {
    case "p":
      return formatLong3.time({ width: "short" });
    case "pp":
      return formatLong3.time({ width: "medium" });
    case "ppp":
      return formatLong3.time({ width: "long" });
    case "pppp":
    default:
      return formatLong3.time({ width: "full" });
  }
};
var dateTimeLongFormatter = (pattern, formatLong3) => {
  const matchResult = pattern.match(/(P+)(p+)?/) || [];
  const datePattern = matchResult[1];
  const timePattern = matchResult[2];
  if (!timePattern) {
    return dateLongFormatter(pattern, formatLong3);
  }
  let dateTimeFormat;
  switch (datePattern) {
    case "P":
      dateTimeFormat = formatLong3.dateTime({ width: "short" });
      break;
    case "PP":
      dateTimeFormat = formatLong3.dateTime({ width: "medium" });
      break;
    case "PPP":
      dateTimeFormat = formatLong3.dateTime({ width: "long" });
      break;
    case "PPPP":
    default:
      dateTimeFormat = formatLong3.dateTime({ width: "full" });
      break;
  }
  return dateTimeFormat.replace("{{date}}", dateLongFormatter(datePattern, formatLong3)).replace("{{time}}", timeLongFormatter(timePattern, formatLong3));
};
var longFormatters = {
  p: timeLongFormatter,
  P: dateTimeLongFormatter
};

// node_modules/date-fns/_lib/protectedTokens.mjs
var dayOfYearTokenRE = /^D+$/;
var weekYearTokenRE = /^Y+$/;
var throwTokens = ["D", "DD", "YY", "YYYY"];
function isProtectedDayOfYearToken(token) {
  return dayOfYearTokenRE.test(token);
}
function isProtectedWeekYearToken(token) {
  return weekYearTokenRE.test(token);
}
function warnOrThrowProtectedError(token, format3, input) {
  const _message = message(token, format3, input);
  console.warn(_message);
  if (throwTokens.includes(token)) throw new RangeError(_message);
}
function message(token, format3, input) {
  const subject = token[0] === "Y" ? "years" : "days of the month";
  return `Use \`${token.toLowerCase()}\` instead of \`${token}\` (in \`${format3}\`) for formatting ${subject} to the input \`${input}\`; see: https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md`;
}

// node_modules/date-fns/format.mjs
var formattingTokensRegExp = /[yYQqMLwIdDecihHKkms]o|(\w)\1*|''|'(''|[^'])+('|$)|./g;
var longFormattingTokensRegExp = /P+p+|P+|p+|''|'(''|[^'])+('|$)|./g;
var escapedStringRegExp = /^'([^]*?)'?$/;
var doubleQuoteRegExp = /''/g;
var unescapedLatinCharacterRegExp = /[a-zA-Z]/;
function format(date, formatStr, options) {
  const defaultOptions2 = getDefaultOptions();
  const locale = options?.locale ?? defaultOptions2.locale ?? enUS;
  const firstWeekContainsDate = options?.firstWeekContainsDate ?? options?.locale?.options?.firstWeekContainsDate ?? defaultOptions2.firstWeekContainsDate ?? defaultOptions2.locale?.options?.firstWeekContainsDate ?? 1;
  const weekStartsOn = options?.weekStartsOn ?? options?.locale?.options?.weekStartsOn ?? defaultOptions2.weekStartsOn ?? defaultOptions2.locale?.options?.weekStartsOn ?? 0;
  const originalDate = toDate(date);
  if (!isValid(originalDate)) {
    throw new RangeError("Invalid time value");
  }
  let parts = formatStr.match(longFormattingTokensRegExp).map((substring) => {
    const firstCharacter = substring[0];
    if (firstCharacter === "p" || firstCharacter === "P") {
      const longFormatter = longFormatters[firstCharacter];
      return longFormatter(substring, locale.formatLong);
    }
    return substring;
  }).join("").match(formattingTokensRegExp).map((substring) => {
    if (substring === "''") {
      return { isToken: false, value: "'" };
    }
    const firstCharacter = substring[0];
    if (firstCharacter === "'") {
      return { isToken: false, value: cleanEscapedString(substring) };
    }
    if (formatters[firstCharacter]) {
      return { isToken: true, value: substring };
    }
    if (firstCharacter.match(unescapedLatinCharacterRegExp)) {
      throw new RangeError(
        "Format string contains an unescaped latin alphabet character `" + firstCharacter + "`"
      );
    }
    return { isToken: false, value: substring };
  });
  if (locale.localize.preprocessor) {
    parts = locale.localize.preprocessor(originalDate, parts);
  }
  const formatterOptions = {
    firstWeekContainsDate,
    weekStartsOn,
    locale
  };
  return parts.map((part) => {
    if (!part.isToken) return part.value;
    const token = part.value;
    if (!options?.useAdditionalWeekYearTokens && isProtectedWeekYearToken(token) || !options?.useAdditionalDayOfYearTokens && isProtectedDayOfYearToken(token)) {
      warnOrThrowProtectedError(token, formatStr, String(date));
    }
    const formatter = formatters[token[0]];
    return formatter(originalDate, token, locale.localize, formatterOptions);
  }).join("");
}
function cleanEscapedString(input) {
  const matched = input.match(escapedStringRegExp);
  if (!matched) {
    return input;
  }
  return matched[1].replace(doubleQuoteRegExp, "'");
}

// node_modules/date-fns/locale/es/_lib/formatDistance.mjs
var formatDistanceLocale2 = {
  lessThanXSeconds: {
    one: "menos de un segundo",
    other: "menos de {{count}} segundos"
  },
  xSeconds: {
    one: "1 segundo",
    other: "{{count}} segundos"
  },
  halfAMinute: "medio minuto",
  lessThanXMinutes: {
    one: "menos de un minuto",
    other: "menos de {{count}} minutos"
  },
  xMinutes: {
    one: "1 minuto",
    other: "{{count}} minutos"
  },
  aboutXHours: {
    one: "alrededor de 1 hora",
    other: "alrededor de {{count}} horas"
  },
  xHours: {
    one: "1 hora",
    other: "{{count}} horas"
  },
  xDays: {
    one: "1 d\xEDa",
    other: "{{count}} d\xEDas"
  },
  aboutXWeeks: {
    one: "alrededor de 1 semana",
    other: "alrededor de {{count}} semanas"
  },
  xWeeks: {
    one: "1 semana",
    other: "{{count}} semanas"
  },
  aboutXMonths: {
    one: "alrededor de 1 mes",
    other: "alrededor de {{count}} meses"
  },
  xMonths: {
    one: "1 mes",
    other: "{{count}} meses"
  },
  aboutXYears: {
    one: "alrededor de 1 a\xF1o",
    other: "alrededor de {{count}} a\xF1os"
  },
  xYears: {
    one: "1 a\xF1o",
    other: "{{count}} a\xF1os"
  },
  overXYears: {
    one: "m\xE1s de 1 a\xF1o",
    other: "m\xE1s de {{count}} a\xF1os"
  },
  almostXYears: {
    one: "casi 1 a\xF1o",
    other: "casi {{count}} a\xF1os"
  }
};
var formatDistance2 = (token, count, options) => {
  let result;
  const tokenValue = formatDistanceLocale2[token];
  if (typeof tokenValue === "string") {
    result = tokenValue;
  } else if (count === 1) {
    result = tokenValue.one;
  } else {
    result = tokenValue.other.replace("{{count}}", count.toString());
  }
  if (options?.addSuffix) {
    if (options.comparison && options.comparison > 0) {
      return "en " + result;
    } else {
      return "hace " + result;
    }
  }
  return result;
};

// node_modules/date-fns/locale/es/_lib/formatLong.mjs
var dateFormats2 = {
  full: "EEEE, d 'de' MMMM 'de' y",
  long: "d 'de' MMMM 'de' y",
  medium: "d MMM y",
  short: "dd/MM/y"
};
var timeFormats2 = {
  full: "HH:mm:ss zzzz",
  long: "HH:mm:ss z",
  medium: "HH:mm:ss",
  short: "HH:mm"
};
var dateTimeFormats2 = {
  full: "{{date}} 'a las' {{time}}",
  long: "{{date}} 'a las' {{time}}",
  medium: "{{date}}, {{time}}",
  short: "{{date}}, {{time}}"
};
var formatLong2 = {
  date: buildFormatLongFn({
    formats: dateFormats2,
    defaultWidth: "full"
  }),
  time: buildFormatLongFn({
    formats: timeFormats2,
    defaultWidth: "full"
  }),
  dateTime: buildFormatLongFn({
    formats: dateTimeFormats2,
    defaultWidth: "full"
  })
};

// node_modules/date-fns/locale/es/_lib/formatRelative.mjs
var formatRelativeLocale2 = {
  lastWeek: "'el' eeee 'pasado a la' p",
  yesterday: "'ayer a la' p",
  today: "'hoy a la' p",
  tomorrow: "'ma\xF1ana a la' p",
  nextWeek: "eeee 'a la' p",
  other: "P"
};
var formatRelativeLocalePlural = {
  lastWeek: "'el' eeee 'pasado a las' p",
  yesterday: "'ayer a las' p",
  today: "'hoy a las' p",
  tomorrow: "'ma\xF1ana a las' p",
  nextWeek: "eeee 'a las' p",
  other: "P"
};
var formatRelative2 = (token, date, _baseDate, _options) => {
  if (date.getHours() !== 1) {
    return formatRelativeLocalePlural[token];
  } else {
    return formatRelativeLocale2[token];
  }
};

// node_modules/date-fns/locale/es/_lib/localize.mjs
var eraValues2 = {
  narrow: ["AC", "DC"],
  abbreviated: ["AC", "DC"],
  wide: ["antes de cristo", "despu\xE9s de cristo"]
};
var quarterValues2 = {
  narrow: ["1", "2", "3", "4"],
  abbreviated: ["T1", "T2", "T3", "T4"],
  wide: ["1\xBA trimestre", "2\xBA trimestre", "3\xBA trimestre", "4\xBA trimestre"]
};
var monthValues2 = {
  narrow: ["e", "f", "m", "a", "m", "j", "j", "a", "s", "o", "n", "d"],
  abbreviated: [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic"
  ],
  wide: [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre"
  ]
};
var dayValues2 = {
  narrow: ["d", "l", "m", "m", "j", "v", "s"],
  short: ["do", "lu", "ma", "mi", "ju", "vi", "s\xE1"],
  abbreviated: ["dom", "lun", "mar", "mi\xE9", "jue", "vie", "s\xE1b"],
  wide: [
    "domingo",
    "lunes",
    "martes",
    "mi\xE9rcoles",
    "jueves",
    "viernes",
    "s\xE1bado"
  ]
};
var dayPeriodValues2 = {
  narrow: {
    am: "a",
    pm: "p",
    midnight: "mn",
    noon: "md",
    morning: "ma\xF1ana",
    afternoon: "tarde",
    evening: "tarde",
    night: "noche"
  },
  abbreviated: {
    am: "AM",
    pm: "PM",
    midnight: "medianoche",
    noon: "mediodia",
    morning: "ma\xF1ana",
    afternoon: "tarde",
    evening: "tarde",
    night: "noche"
  },
  wide: {
    am: "a.m.",
    pm: "p.m.",
    midnight: "medianoche",
    noon: "mediodia",
    morning: "ma\xF1ana",
    afternoon: "tarde",
    evening: "tarde",
    night: "noche"
  }
};
var formattingDayPeriodValues2 = {
  narrow: {
    am: "a",
    pm: "p",
    midnight: "mn",
    noon: "md",
    morning: "de la ma\xF1ana",
    afternoon: "de la tarde",
    evening: "de la tarde",
    night: "de la noche"
  },
  abbreviated: {
    am: "AM",
    pm: "PM",
    midnight: "medianoche",
    noon: "mediodia",
    morning: "de la ma\xF1ana",
    afternoon: "de la tarde",
    evening: "de la tarde",
    night: "de la noche"
  },
  wide: {
    am: "a.m.",
    pm: "p.m.",
    midnight: "medianoche",
    noon: "mediodia",
    morning: "de la ma\xF1ana",
    afternoon: "de la tarde",
    evening: "de la tarde",
    night: "de la noche"
  }
};
var ordinalNumber2 = (dirtyNumber, _options) => {
  const number = Number(dirtyNumber);
  return number + "\xBA";
};
var localize2 = {
  ordinalNumber: ordinalNumber2,
  era: buildLocalizeFn({
    values: eraValues2,
    defaultWidth: "wide"
  }),
  quarter: buildLocalizeFn({
    values: quarterValues2,
    defaultWidth: "wide",
    argumentCallback: (quarter) => Number(quarter) - 1
  }),
  month: buildLocalizeFn({
    values: monthValues2,
    defaultWidth: "wide"
  }),
  day: buildLocalizeFn({
    values: dayValues2,
    defaultWidth: "wide"
  }),
  dayPeriod: buildLocalizeFn({
    values: dayPeriodValues2,
    defaultWidth: "wide",
    formattingValues: formattingDayPeriodValues2,
    defaultFormattingWidth: "wide"
  })
};

// node_modules/date-fns/locale/es/_lib/match.mjs
var matchOrdinalNumberPattern2 = /^(\d+)(º)?/i;
var parseOrdinalNumberPattern2 = /\d+/i;
var matchEraPatterns2 = {
  narrow: /^(ac|dc|a|d)/i,
  abbreviated: /^(a\.?\s?c\.?|a\.?\s?e\.?\s?c\.?|d\.?\s?c\.?|e\.?\s?c\.?)/i,
  wide: /^(antes de cristo|antes de la era com[uú]n|despu[eé]s de cristo|era com[uú]n)/i
};
var parseEraPatterns2 = {
  any: [/^ac/i, /^dc/i],
  wide: [
    /^(antes de cristo|antes de la era com[uú]n)/i,
    /^(despu[eé]s de cristo|era com[uú]n)/i
  ]
};
var matchQuarterPatterns2 = {
  narrow: /^[1234]/i,
  abbreviated: /^T[1234]/i,
  wide: /^[1234](º)? trimestre/i
};
var parseQuarterPatterns2 = {
  any: [/1/i, /2/i, /3/i, /4/i]
};
var matchMonthPatterns2 = {
  narrow: /^[efmajsond]/i,
  abbreviated: /^(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/i,
  wide: /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i
};
var parseMonthPatterns2 = {
  narrow: [
    /^e/i,
    /^f/i,
    /^m/i,
    /^a/i,
    /^m/i,
    /^j/i,
    /^j/i,
    /^a/i,
    /^s/i,
    /^o/i,
    /^n/i,
    /^d/i
  ],
  any: [
    /^en/i,
    /^feb/i,
    /^mar/i,
    /^abr/i,
    /^may/i,
    /^jun/i,
    /^jul/i,
    /^ago/i,
    /^sep/i,
    /^oct/i,
    /^nov/i,
    /^dic/i
  ]
};
var matchDayPatterns2 = {
  narrow: /^[dlmjvs]/i,
  short: /^(do|lu|ma|mi|ju|vi|s[áa])/i,
  abbreviated: /^(dom|lun|mar|mi[ée]|jue|vie|s[áa]b)/i,
  wide: /^(domingo|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado)/i
};
var parseDayPatterns2 = {
  narrow: [/^d/i, /^l/i, /^m/i, /^m/i, /^j/i, /^v/i, /^s/i],
  any: [/^do/i, /^lu/i, /^ma/i, /^mi/i, /^ju/i, /^vi/i, /^sa/i]
};
var matchDayPeriodPatterns2 = {
  narrow: /^(a|p|mn|md|(de la|a las) (mañana|tarde|noche))/i,
  any: /^([ap]\.?\s?m\.?|medianoche|mediodia|(de la|a las) (mañana|tarde|noche))/i
};
var parseDayPeriodPatterns2 = {
  any: {
    am: /^a/i,
    pm: /^p/i,
    midnight: /^mn/i,
    noon: /^md/i,
    morning: /mañana/i,
    afternoon: /tarde/i,
    evening: /tarde/i,
    night: /noche/i
  }
};
var match2 = {
  ordinalNumber: buildMatchPatternFn({
    matchPattern: matchOrdinalNumberPattern2,
    parsePattern: parseOrdinalNumberPattern2,
    valueCallback: function(value) {
      return parseInt(value, 10);
    }
  }),
  era: buildMatchFn({
    matchPatterns: matchEraPatterns2,
    defaultMatchWidth: "wide",
    parsePatterns: parseEraPatterns2,
    defaultParseWidth: "any"
  }),
  quarter: buildMatchFn({
    matchPatterns: matchQuarterPatterns2,
    defaultMatchWidth: "wide",
    parsePatterns: parseQuarterPatterns2,
    defaultParseWidth: "any",
    valueCallback: (index) => index + 1
  }),
  month: buildMatchFn({
    matchPatterns: matchMonthPatterns2,
    defaultMatchWidth: "wide",
    parsePatterns: parseMonthPatterns2,
    defaultParseWidth: "any"
  }),
  day: buildMatchFn({
    matchPatterns: matchDayPatterns2,
    defaultMatchWidth: "wide",
    parsePatterns: parseDayPatterns2,
    defaultParseWidth: "any"
  }),
  dayPeriod: buildMatchFn({
    matchPatterns: matchDayPeriodPatterns2,
    defaultMatchWidth: "any",
    parsePatterns: parseDayPeriodPatterns2,
    defaultParseWidth: "any"
  })
};

// node_modules/date-fns/locale/es.mjs
var es = {
  code: "es",
  formatDistance: formatDistance2,
  formatLong: formatLong2,
  formatRelative: formatRelative2,
  localize: localize2,
  match: match2,
  options: {
    weekStartsOn: 1,
    firstWeekContainsDate: 1
  }
};

// src/lib/dates.ts
function toDate2(value) {
  if (!value) return /* @__PURE__ */ new Date();
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      return value.toDate();
    } catch {
      return /* @__PURE__ */ new Date();
    }
  }
  if (typeof value === "number") return new Date(value);
  const d = new Date(value);
  return isNaN(d.getTime()) ? /* @__PURE__ */ new Date() : d;
}
var DIA_BOGOTA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
var dayKey = (v) => DIA_BOGOTA.format(toDate2(v));
function daysFromToday(v, now = /* @__PURE__ */ new Date()) {
  const a = Date.parse(`${dayKey(v)}T00:00:00Z`);
  const b = Date.parse(`${dayKey(now)}T00:00:00Z`);
  return Math.round((a - b) / 864e5);
}
function endOfTodayBogota(now = /* @__PURE__ */ new Date()) {
  return new Date(Date.parse(`${dayKey(now)}T00:00:00Z`) + 864e5 + 5 * 36e5);
}
function sessionDateFromKey(key) {
  return /* @__PURE__ */ new Date(`${key}T12:00:00-05:00`);
}
var fmtDate = (v) => format(toDate2(v), "d MMM yyyy", { locale: es });
function isValidDateKey(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = /* @__PURE__ */ new Date(`${str}T12:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().startsWith(str);
}

// node_modules/fuse.js/dist/fuse.mjs
function isArray(value) {
  return !Array.isArray ? getTag(value) === "[object Array]" : Array.isArray(value);
}
function baseToString(value) {
  if (typeof value == "string") return value;
  if (typeof value === "bigint") return value.toString();
  const result = value + "";
  return result == "0" && 1 / value == -Infinity ? "-0" : result;
}
function toString(value) {
  return value == null ? "" : baseToString(value);
}
function isString(value) {
  return typeof value === "string";
}
function isNumber(value) {
  return typeof value === "number";
}
function isBoolean(value) {
  return value === true || value === false || isObjectLike(value) && getTag(value) == "[object Boolean]";
}
function isObject(value) {
  return typeof value === "object";
}
function isObjectLike(value) {
  return isObject(value) && value !== null;
}
function isDefined(value) {
  return value !== void 0 && value !== null;
}
function isBlank(value) {
  return !value.trim().length;
}
function getTag(value) {
  return value == null ? value === void 0 ? "[object Undefined]" : "[object Null]" : Object.prototype.toString.call(value);
}
var INCORRECT_INDEX_TYPE = "Incorrect 'index' type";
var INVALID_DOC_INDEX = "Invalid doc index: must be a non-negative integer within the bounds of the docs array";
var LOGICAL_SEARCH_INVALID_QUERY_FOR_KEY = (key) => `Invalid value for key ${key}`;
var PATTERN_LENGTH_TOO_LARGE = (max) => `Pattern length exceeds max of ${max}.`;
var MISSING_KEY_PROPERTY = (name) => `Missing ${name} property in key`;
var INVALID_KEY_WEIGHT_VALUE = (key) => `Property 'weight' in key '${key}' must be a positive integer`;
var FUSE_MATCH_TOKEN_SEARCH_UNSUPPORTED = "Fuse.match does not support useTokenSearch: token search requires corpus-level statistics (df, fieldCount) that a one-off string comparison does not have. Use new Fuse(...).search(...) instead.";
var hasOwn = Object.prototype.hasOwnProperty;
var KeyStore = class {
  constructor(keys) {
    this._keys = [];
    this._keyMap = {};
    let totalWeight = 0;
    keys.forEach((key) => {
      const obj = createKey(key);
      this._keys.push(obj);
      this._keyMap[obj.id] = obj;
      totalWeight += obj.weight;
    });
    this._keys.forEach((key) => {
      key.weight /= totalWeight;
    });
  }
  get(keyId) {
    return this._keyMap[keyId];
  }
  keys() {
    return this._keys;
  }
  toJSON() {
    return JSON.stringify(this._keys);
  }
};
function createKey(key) {
  let path = null;
  let id = null;
  let src = null;
  let weight = 1;
  let getFn = null;
  if (isString(key) || isArray(key)) {
    src = key;
    path = createKeyPath(key);
    id = createKeyId(key);
  } else {
    if (!hasOwn.call(key, "name")) throw new Error(MISSING_KEY_PROPERTY("name"));
    const name = key.name;
    src = name;
    if (hasOwn.call(key, "weight") && key.weight !== void 0) {
      weight = key.weight;
      if (weight <= 0) throw new Error(INVALID_KEY_WEIGHT_VALUE(createKeyId(name)));
    }
    path = createKeyPath(name);
    id = createKeyId(name);
    getFn = key.getFn ?? null;
  }
  return {
    path,
    id,
    weight,
    src,
    getFn
  };
}
function createKeyPath(key) {
  return isArray(key) ? key : key.split(".");
}
function createKeyId(key) {
  return isArray(key) ? key.join(".") : key;
}
function get(obj, path) {
  const list = [];
  let arr = false;
  const deepGet = (obj2, path2, index, arrayIndex) => {
    if (!isDefined(obj2)) return;
    if (!path2[index]) list.push(arrayIndex !== void 0 ? {
      v: obj2,
      i: arrayIndex
    } : obj2);
    else {
      const value = obj2[path2[index]];
      if (!isDefined(value)) return;
      if (index === path2.length - 1 && (isString(value) || isNumber(value) || isBoolean(value) || typeof value === "bigint")) list.push(arrayIndex !== void 0 ? {
        v: toString(value),
        i: arrayIndex
      } : toString(value));
      else if (isArray(value)) {
        arr = true;
        for (let i = 0, len = value.length; i < len; i += 1) deepGet(value[i], path2, index + 1, i);
      } else if (path2.length) deepGet(value, path2, index + 1, arrayIndex);
    }
  };
  deepGet(obj, isString(path) ? path.split(".") : path, 0);
  return arr ? list : list[0];
}
var MatchOptions = {
  includeMatches: false,
  findAllMatches: false,
  minMatchCharLength: 1
};
var BasicOptions = {
  isCaseSensitive: false,
  ignoreDiacritics: false,
  includeScore: false,
  keys: [],
  shouldSort: true,
  sortFn: (a, b) => a.score === b.score ? a.idx < b.idx ? -1 : 1 : a.score < b.score ? -1 : 1
};
var FuzzyOptions = {
  location: 0,
  threshold: 0.6,
  distance: 100
};
var AdvancedOptions = {
  useExtendedSearch: false,
  useTokenSearch: false,
  tokenize: void 0,
  tokenMatch: "any",
  getFn: get,
  ignoreLocation: false,
  ignoreFieldNorm: false,
  fieldNormWeight: 1
};
var Config = Object.freeze({
  ...BasicOptions,
  ...MatchOptions,
  ...FuzzyOptions,
  ...AdvancedOptions
});
function norm(weight = 1, mantissa = 3) {
  const cache2 = /* @__PURE__ */ new Map();
  const m = Math.pow(10, mantissa);
  return {
    get(value) {
      let numTokens = 1;
      let inSpace = false;
      for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 32) {
        if (!inSpace) {
          numTokens++;
          inSpace = true;
        }
      } else inSpace = false;
      if (cache2.has(numTokens)) return cache2.get(numTokens);
      const n = Math.round(m / Math.pow(numTokens, 0.5 * weight)) / m;
      cache2.set(numTokens, n);
      return n;
    },
    clear() {
      cache2.clear();
    }
  };
}
var FuseIndex = class {
  constructor({ getFn = Config.getFn, fieldNormWeight = Config.fieldNormWeight } = {}) {
    this.norm = norm(fieldNormWeight, 3);
    this.getFn = getFn;
    this.isCreated = false;
    this.docs = [];
    this.keys = [];
    this._keysMap = {};
    this.setIndexRecords();
  }
  setSources(docs = []) {
    this.docs = docs;
  }
  setIndexRecords(records = []) {
    this.records = records;
  }
  setKeys(keys = []) {
    this.keys = keys;
    this._keysMap = {};
    keys.forEach((key, idx) => {
      this._keysMap[key.id] = idx;
    });
  }
  create() {
    if (this.isCreated || !this.docs.length) return;
    this.isCreated = true;
    const len = this.docs.length;
    this.records = new Array(len);
    let recordCount = 0;
    if (isString(this.docs[0])) for (let i = 0; i < len; i++) {
      const record = this._createStringRecord(this.docs[i], i);
      if (record) this.records[recordCount++] = record;
    }
    else for (let i = 0; i < len; i++) this.records[recordCount++] = this._createObjectRecord(this.docs[i], i);
    this.records.length = recordCount;
    this.norm.clear();
  }
  add(doc, docIndex) {
    if (!Number.isInteger(docIndex) || docIndex < 0) throw new Error(INVALID_DOC_INDEX);
    if (isString(doc)) {
      const record2 = this._createStringRecord(doc, docIndex);
      if (record2) this.records.push(record2);
      return record2;
    }
    const record = this._createObjectRecord(doc, docIndex);
    this.records.push(record);
    return record;
  }
  removeAt(idx) {
    if (!Number.isInteger(idx) || idx < 0) throw new Error(INVALID_DOC_INDEX);
    for (let i = 0, len = this.records.length; i < len; i += 1) if (this.records[i].i === idx) {
      this.records.splice(i, 1);
      break;
    }
    for (let i = 0, len = this.records.length; i < len; i += 1) if (this.records[i].i > idx) this.records[i].i -= 1;
  }
  removeAll(indices) {
    const toRemove = /* @__PURE__ */ new Set();
    for (const v of indices) if (Number.isInteger(v) && v >= 0) toRemove.add(v);
    if (toRemove.size === 0) return;
    this.records = this.records.filter((r) => !toRemove.has(r.i));
    const sorted = Array.from(toRemove).sort((a, b) => a - b);
    for (const record of this.records) {
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = lo + hi >>> 1;
        if (sorted[mid] < record.i) lo = mid + 1;
        else hi = mid;
      }
      record.i -= lo;
    }
  }
  getValueForItemAtKeyId(item, keyId) {
    return item[this._keysMap[keyId]];
  }
  size() {
    return this.records.length;
  }
  _createStringRecord(doc, docIndex) {
    if (!isDefined(doc) || isBlank(doc)) return null;
    return {
      v: doc,
      i: docIndex,
      n: this.norm.get(doc)
    };
  }
  _createObjectRecord(doc, docIndex) {
    const record = {
      i: docIndex,
      $: {}
    };
    for (let keyIndex = 0, keyLen = this.keys.length; keyIndex < keyLen; keyIndex++) {
      const key = this.keys[keyIndex];
      const value = key.getFn ? key.getFn(doc) : this.getFn(doc, key.path);
      if (!isDefined(value)) continue;
      if (isArray(value)) {
        const subRecords = [];
        for (let i = 0, len = value.length; i < len; i += 1) {
          const item = value[i];
          if (!isDefined(item)) continue;
          if (isString(item)) {
            if (!isBlank(item)) {
              const subRecord = {
                v: item,
                i,
                n: this.norm.get(item)
              };
              subRecords.push(subRecord);
            }
          } else if (isDefined(item.v)) {
            const text = isString(item.v) ? item.v : toString(item.v);
            if (!isBlank(text)) {
              const subRecord = {
                v: text,
                i: item.i,
                n: this.norm.get(text)
              };
              subRecords.push(subRecord);
            }
          }
        }
        record.$[keyIndex] = subRecords;
      } else if (isString(value) && !isBlank(value)) {
        const subRecord = {
          v: value,
          n: this.norm.get(value)
        };
        record.$[keyIndex] = subRecord;
      }
    }
    return record;
  }
  toJSON() {
    return {
      keys: this.keys.map(({ getFn, ...key }) => key),
      records: this.records
    };
  }
};
function createIndex(keys, docs, { getFn = Config.getFn, fieldNormWeight = Config.fieldNormWeight } = {}) {
  const myIndex = new FuseIndex({
    getFn,
    fieldNormWeight
  });
  myIndex.setKeys(keys.map(createKey));
  myIndex.setSources(docs);
  myIndex.create();
  return myIndex;
}
function parseIndex(data, { getFn = Config.getFn, fieldNormWeight = Config.fieldNormWeight } = {}) {
  const { keys, records } = data;
  const myIndex = new FuseIndex({
    getFn,
    fieldNormWeight
  });
  myIndex.setKeys(keys);
  myIndex.setIndexRecords(records);
  return myIndex;
}
function convertMaskToIndices(matchmask = [], minMatchCharLength = Config.minMatchCharLength) {
  const indices = [];
  let start = -1;
  let end = -1;
  let i = 0;
  for (let len = matchmask.length; i < len; i += 1) {
    const match3 = matchmask[i];
    if (match3 && start === -1) start = i;
    else if (!match3 && start !== -1) {
      end = i - 1;
      if (end - start + 1 >= minMatchCharLength) indices.push([start, end]);
      start = -1;
    }
  }
  if (matchmask[i - 1] && i - start >= minMatchCharLength) indices.push([start, i - 1]);
  return indices;
}
function search(text, pattern, patternAlphabet, { location = Config.location, distance = Config.distance, threshold = Config.threshold, findAllMatches = Config.findAllMatches, minMatchCharLength = Config.minMatchCharLength, includeMatches = Config.includeMatches, ignoreLocation = Config.ignoreLocation } = {}) {
  if (pattern.length > 32) throw new Error(PATTERN_LENGTH_TOO_LARGE(32));
  const patternLen = pattern.length;
  const textLen = text.length;
  const expectedLocation = Math.max(0, Math.min(location, textLen));
  let currentThreshold = threshold;
  let bestLocation = expectedLocation;
  const calcScore = (errors, currentLocation) => {
    const accuracy = errors / patternLen;
    if (ignoreLocation) return accuracy;
    const proximity = Math.abs(expectedLocation - currentLocation);
    if (!distance) return proximity ? 1 : accuracy;
    return accuracy + proximity / distance;
  };
  const computeMatches = minMatchCharLength > 1 || includeMatches;
  const matchMask = computeMatches ? Array(textLen) : [];
  let index;
  while ((index = text.indexOf(pattern, bestLocation)) > -1) {
    const score = calcScore(0, index);
    currentThreshold = Math.min(score, currentThreshold);
    bestLocation = index + patternLen;
    if (computeMatches) {
      let i = 0;
      while (i < patternLen) {
        matchMask[index + i] = 1;
        i += 1;
      }
    }
  }
  bestLocation = -1;
  let lastBitArr = [];
  let finalScore = 1;
  let bestErrors = 0;
  let binMax = patternLen + textLen;
  const mask = 1 << patternLen - 1;
  for (let i = 0; i < patternLen; i += 1) {
    let binMin = 0;
    let binMid = binMax;
    while (binMin < binMid) {
      if (calcScore(i, expectedLocation + binMid) <= currentThreshold) binMin = binMid;
      else binMax = binMid;
      binMid = Math.floor((binMax - binMin) / 2 + binMin);
    }
    binMax = binMid;
    let start = Math.max(1, expectedLocation - binMid + 1);
    const finish = findAllMatches ? textLen : Math.min(expectedLocation + binMid, textLen) + patternLen;
    const bitArr = Array(finish + 2);
    bitArr[finish + 1] = (1 << i) - 1;
    for (let j = finish; j >= start; j -= 1) {
      const currentLocation = j - 1;
      const charMatch = patternAlphabet[text[currentLocation]];
      bitArr[j] = (bitArr[j + 1] << 1 | 1) & charMatch;
      if (i) bitArr[j] |= (lastBitArr[j + 1] | lastBitArr[j]) << 1 | 1 | lastBitArr[j + 1];
      if (bitArr[j] & mask) {
        finalScore = calcScore(i, currentLocation);
        if (finalScore <= currentThreshold) {
          currentThreshold = finalScore;
          bestLocation = currentLocation;
          bestErrors = i;
          if (bestLocation <= expectedLocation) break;
          start = Math.max(1, 2 * expectedLocation - bestLocation);
        }
      }
    }
    if (calcScore(i + 1, expectedLocation) > currentThreshold) break;
    lastBitArr = bitArr;
  }
  if (computeMatches && bestLocation >= 0) {
    const matchEnd = Math.min(textLen - 1, bestLocation + patternLen - 1 + bestErrors);
    for (let k = bestLocation; k <= matchEnd; k += 1) if (patternAlphabet[text[k]]) matchMask[k] = 1;
  }
  const result = {
    isMatch: bestLocation >= 0,
    score: Math.max(1e-3, finalScore)
  };
  if (computeMatches) {
    const indices = convertMaskToIndices(matchMask, minMatchCharLength);
    if (!indices.length) result.isMatch = false;
    else if (includeMatches) result.indices = indices;
  }
  return result;
}
function createPatternAlphabet(pattern) {
  const mask = {};
  for (let i = 0, len = pattern.length; i < len; i += 1) {
    const char = pattern.charAt(i);
    mask[char] = (mask[char] || 0) | 1 << len - i - 1;
  }
  return mask;
}
function mergeIndices(indices) {
  if (indices.length <= 1) return indices;
  indices.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [indices[0]];
  for (let i = 1, len = indices.length; i < len; i += 1) {
    const last = merged[merged.length - 1];
    const curr = indices[i];
    if (curr[0] <= last[1] + 1) last[1] = Math.max(last[1], curr[1]);
    else merged.push(curr);
  }
  return merged;
}
var NON_DECOMPOSABLE_MAP = {
  "\u0142": "l",
  "\u0141": "L",
  "\u0111": "d",
  "\u0110": "D",
  "\xF8": "o",
  "\xD8": "O",
  "\u0127": "h",
  "\u0126": "H",
  "\u0167": "t",
  "\u0166": "T",
  "\u0131": "i",
  "\xDF": "ss"
};
var NON_DECOMPOSABLE_RE = new RegExp("[" + Object.keys(NON_DECOMPOSABLE_MAP).join("") + "]", "g");
var stripDiacritics = typeof String.prototype.normalize === "function" ? (str) => str.normalize("NFD").replace(/[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B62\u0B63\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0C00-\u0C04\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D82\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F\u109A-\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u180B-\u180D\u1885\u1886\u18A9\u1920-\u192B\u1930-\u193B\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B04\u1B34-\u1B44\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BE6-\u1BF3\u1C24-\u1C37\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF2-\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DF9\u1DFB-\u1DFF\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\uA66F-\uA672\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA880\uA881\uA8B4-\uA8C5\uA8E0-\uA8F1\uA8FF\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9E5\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F]/g, "").replace(NON_DECOMPOSABLE_RE, (ch) => NON_DECOMPOSABLE_MAP[ch]) : (str) => str;
var BitapSearch = class {
  constructor(pattern, { location = Config.location, threshold = Config.threshold, distance = Config.distance, includeMatches = Config.includeMatches, findAllMatches = Config.findAllMatches, minMatchCharLength = Config.minMatchCharLength, isCaseSensitive = Config.isCaseSensitive, ignoreDiacritics = Config.ignoreDiacritics, ignoreLocation = Config.ignoreLocation } = {}) {
    this.options = {
      location,
      threshold,
      distance,
      includeMatches,
      findAllMatches,
      minMatchCharLength,
      isCaseSensitive,
      ignoreDiacritics,
      ignoreLocation
    };
    pattern = isCaseSensitive ? pattern : pattern.toLowerCase();
    pattern = ignoreDiacritics ? stripDiacritics(pattern) : pattern;
    this.pattern = pattern;
    this.chunks = [];
    if (!this.pattern.length) return;
    const addChunk = (pattern2, startIndex) => {
      this.chunks.push({
        pattern: pattern2,
        alphabet: createPatternAlphabet(pattern2),
        startIndex
      });
    };
    const len = this.pattern.length;
    if (len > 32) {
      let i = 0;
      const remainder = len % 32;
      const end = len - remainder;
      while (i < end) {
        addChunk(this.pattern.substr(i, 32), i);
        i += 32;
      }
      if (remainder) {
        const startIndex = len - 32;
        addChunk(this.pattern.substr(startIndex), startIndex);
      }
    } else addChunk(this.pattern, 0);
  }
  searchIn(text) {
    const { isCaseSensitive, ignoreDiacritics, includeMatches } = this.options;
    text = isCaseSensitive ? text : text.toLowerCase();
    text = ignoreDiacritics ? stripDiacritics(text) : text;
    if (this.pattern === text) {
      const result2 = {
        isMatch: true,
        score: 0
      };
      if (includeMatches) result2.indices = [[0, text.length - 1]];
      return result2;
    }
    const { location, distance, threshold, findAllMatches, minMatchCharLength, ignoreLocation } = this.options;
    const allIndices = [];
    let totalScore = 0;
    let hasMatches = false;
    this.chunks.forEach(({ pattern, alphabet, startIndex }) => {
      const { isMatch, score, indices } = search(text, pattern, alphabet, {
        location: location + startIndex,
        distance,
        threshold,
        findAllMatches,
        minMatchCharLength,
        includeMatches,
        ignoreLocation
      });
      if (isMatch) hasMatches = true;
      totalScore += score;
      if (isMatch && indices) allIndices.push(...indices);
    });
    const result = {
      isMatch: hasMatches,
      score: hasMatches ? totalScore / this.chunks.length : 1
    };
    if (hasMatches && includeMatches) result.indices = mergeIndices(allIndices);
    return result;
  }
};
var MULTI_MATCH_TYPES = /* @__PURE__ */ new Set(["fuzzy", "include"]);
function isInverse(type) {
  return type.startsWith("inverse");
}
var matchers = [
  {
    type: "exact",
    multiRegex: /^="(.*)"$/,
    singleRegex: /^=(.*)$/,
    create: (pattern) => ({
      type: "exact",
      search(text) {
        const isMatch = text === pattern;
        return {
          isMatch,
          score: isMatch ? 0 : 1,
          indices: [0, pattern.length - 1]
        };
      }
    })
  },
  {
    type: "include",
    multiRegex: /^'"(.*)"$/,
    singleRegex: /^'(.*)$/,
    create: (pattern) => ({
      type: "include",
      search(text) {
        let location = 0;
        let index;
        const indices = [];
        const patternLen = pattern.length;
        while ((index = text.indexOf(pattern, location)) > -1) {
          location = index + patternLen;
          indices.push([index, location - 1]);
        }
        const isMatch = !!indices.length;
        return {
          isMatch,
          score: isMatch ? 0 : 1,
          indices
        };
      }
    })
  },
  {
    type: "prefix-exact",
    multiRegex: /^\^"(.*)"$/,
    singleRegex: /^\^(.*)$/,
    create: (pattern) => ({
      type: "prefix-exact",
      search(text) {
        const isMatch = text.startsWith(pattern);
        return {
          isMatch,
          score: isMatch ? 0 : 1,
          indices: [0, pattern.length - 1]
        };
      }
    })
  },
  {
    type: "inverse-prefix-exact",
    multiRegex: /^!\^"(.*)"$/,
    singleRegex: /^!\^(.*)$/,
    create: (pattern) => ({
      type: "inverse-prefix-exact",
      search(text) {
        const isMatch = !text.startsWith(pattern);
        return {
          isMatch,
          score: isMatch ? 0 : 1,
          indices: [0, text.length - 1]
        };
      }
    })
  },
  {
    type: "inverse-suffix-exact",
    multiRegex: /^!"(.*)"\$$/,
    singleRegex: /^!(.*)\$$/,
    create: (pattern) => ({
      type: "inverse-suffix-exact",
      search(text) {
        const isMatch = !text.endsWith(pattern);
        return {
          isMatch,
          score: isMatch ? 0 : 1,
          indices: [0, text.length - 1]
        };
      }
    })
  },
  {
    type: "suffix-exact",
    multiRegex: /^"(.*)"\$$/,
    singleRegex: /^(.*)\$$/,
    create: (pattern) => ({
      type: "suffix-exact",
      search(text) {
        const isMatch = text.endsWith(pattern);
        return {
          isMatch,
          score: isMatch ? 0 : 1,
          indices: [text.length - pattern.length, text.length - 1]
        };
      }
    })
  },
  {
    type: "inverse-exact",
    multiRegex: /^!"(.*)"$/,
    singleRegex: /^!(.*)$/,
    create: (pattern) => ({
      type: "inverse-exact",
      search(text) {
        const isMatch = text.indexOf(pattern) === -1;
        return {
          isMatch,
          score: isMatch ? 0 : 1,
          indices: [0, text.length - 1]
        };
      }
    })
  },
  {
    type: "fuzzy",
    multiRegex: /^"(.*)"$/,
    singleRegex: /^(.*)$/,
    create: (pattern, options = {}) => {
      const bitap = new BitapSearch(pattern, {
        location: options.location ?? Config.location,
        threshold: options.threshold ?? Config.threshold,
        distance: options.distance ?? Config.distance,
        includeMatches: options.includeMatches ?? Config.includeMatches,
        findAllMatches: options.findAllMatches ?? Config.findAllMatches,
        minMatchCharLength: options.minMatchCharLength ?? Config.minMatchCharLength,
        isCaseSensitive: options.isCaseSensitive ?? Config.isCaseSensitive,
        ignoreDiacritics: options.ignoreDiacritics ?? Config.ignoreDiacritics,
        ignoreLocation: options.ignoreLocation ?? Config.ignoreLocation
      });
      return {
        type: "fuzzy",
        search(text) {
          return bitap.searchIn(text);
        }
      };
    }
  }
];
var matchersLen = matchers.length;
var ESCAPED_PIPE = "\0";
var OR_TOKEN = "|";
function tokenize2(pattern) {
  const tokens = [];
  const len = pattern.length;
  let i = 0;
  while (i < len) {
    while (i < len && pattern[i] === " ") i++;
    if (i >= len) break;
    let j = i;
    while (j < len && pattern[j] !== " " && pattern[j] !== '"') j++;
    if (j < len && pattern[j] === '"') {
      j++;
      while (j < len) {
        if (pattern[j] === '"') {
          const next = j + 1;
          if (next >= len || pattern[next] === " ") {
            j++;
            break;
          }
          if (pattern[next] === "$" && (next + 1 >= len || pattern[next + 1] === " ")) {
            j += 2;
            break;
          }
        }
        j++;
      }
      tokens.push(pattern.substring(i, j));
      i = j;
    } else {
      while (j < len && pattern[j] !== " ") j++;
      tokens.push(pattern.substring(i, j));
      i = j;
    }
  }
  return tokens;
}
function getMatch(pattern, exp) {
  const matches = pattern.match(exp);
  return matches ? matches[1] : null;
}
function parseQuery(pattern, options = {}) {
  return pattern.replace(/\\\|/g, ESCAPED_PIPE).split(OR_TOKEN).map((item) => {
    const query = tokenize2(item.replace(/\u0000/g, "|").trim()).filter((item2) => item2 && !!item2.trim());
    const results = [];
    for (let i = 0, len = query.length; i < len; i += 1) {
      const queryItem = query[i];
      let found = false;
      let idx = -1;
      while (!found && ++idx < matchersLen) {
        const def = matchers[idx];
        const token = getMatch(queryItem, def.multiRegex);
        if (token) {
          results.push(def.create(token, options));
          found = true;
        }
      }
      if (found) continue;
      idx = -1;
      while (++idx < matchersLen) {
        const def = matchers[idx];
        const token = getMatch(queryItem, def.singleRegex);
        if (token) {
          results.push(def.create(token, options));
          break;
        }
      }
    }
    return results;
  });
}
var ExtendedSearch = class {
  constructor(pattern, { isCaseSensitive = Config.isCaseSensitive, ignoreDiacritics = Config.ignoreDiacritics, includeMatches = Config.includeMatches, minMatchCharLength = Config.minMatchCharLength, ignoreLocation = Config.ignoreLocation, findAllMatches = Config.findAllMatches, location = Config.location, threshold = Config.threshold, distance = Config.distance } = {}) {
    this.query = null;
    this.options = {
      isCaseSensitive,
      ignoreDiacritics,
      includeMatches,
      minMatchCharLength,
      findAllMatches,
      ignoreLocation,
      location,
      threshold,
      distance
    };
    pattern = isCaseSensitive ? pattern : pattern.toLowerCase();
    pattern = ignoreDiacritics ? stripDiacritics(pattern) : pattern;
    this.pattern = pattern;
    this.query = parseQuery(this.pattern, this.options);
  }
  static condition(_, options) {
    return options.useExtendedSearch;
  }
  searchIn(text) {
    const query = this.query;
    if (!query) return {
      isMatch: false,
      score: 1
    };
    const { includeMatches, isCaseSensitive, ignoreDiacritics } = this.options;
    text = isCaseSensitive ? text : text.toLowerCase();
    text = ignoreDiacritics ? stripDiacritics(text) : text;
    let numMatches = 0;
    const allIndices = [];
    let totalScore = 0;
    let hasInverse = false;
    for (let i = 0, qLen = query.length; i < qLen; i += 1) {
      const searchers = query[i];
      allIndices.length = 0;
      numMatches = 0;
      hasInverse = false;
      for (let j = 0, pLen = searchers.length; j < pLen; j += 1) {
        const matcher = searchers[j];
        const { isMatch, indices, score } = matcher.search(text);
        if (isMatch) {
          numMatches += 1;
          totalScore += score;
          if (isInverse(matcher.type)) hasInverse = true;
          if (includeMatches) if (MULTI_MATCH_TYPES.has(matcher.type)) allIndices.push(...indices);
          else allIndices.push(indices);
        } else {
          totalScore = 0;
          numMatches = 0;
          allIndices.length = 0;
          hasInverse = false;
          break;
        }
      }
      if (numMatches) {
        const result = {
          isMatch: true,
          score: totalScore / numMatches
        };
        if (hasInverse) result.hasInverse = true;
        if (includeMatches) result.indices = mergeIndices(allIndices);
        return result;
      }
    }
    return {
      isMatch: false,
      score: 1
    };
  }
};
var registeredSearchers = [];
function register(...args) {
  registeredSearchers.push(...args);
}
function createSearcher(pattern, options) {
  for (let i = 0, len = registeredSearchers.length; i < len; i += 1) {
    const searcherClass = registeredSearchers[i];
    if (searcherClass.condition(pattern, options)) return new searcherClass(pattern, options);
  }
  return new BitapSearch(pattern, options);
}
var LogicalOperator = {
  AND: "$and",
  OR: "$or"
};
var KeyType = {
  PATH: "$path",
  PATTERN: "$val"
};
var isExpression = (query) => !!(query[LogicalOperator.AND] || query[LogicalOperator.OR]);
var isPath = (query) => !!query[KeyType.PATH];
var isLeaf = (query) => !isArray(query) && isObject(query) && !isExpression(query);
var convertToExplicit = (query) => ({ [LogicalOperator.AND]: Object.keys(query).map((key) => ({ [key]: query[key] })) });
function parse(query, options, { auto = true } = {}) {
  const next = (query2) => {
    if (isString(query2)) {
      const obj = {
        keyId: null,
        pattern: query2
      };
      if (auto) obj.searcher = createSearcher(query2, options);
      return obj;
    }
    const keys = Object.keys(query2);
    const isQueryPath = isPath(query2);
    if (!isQueryPath && keys.length > 1 && !isExpression(query2)) return next(convertToExplicit(query2));
    if (isLeaf(query2)) {
      const key = isQueryPath ? query2[KeyType.PATH] : keys[0];
      const pattern = isQueryPath ? query2[KeyType.PATTERN] : query2[key];
      if (!isString(pattern)) throw new Error(LOGICAL_SEARCH_INVALID_QUERY_FOR_KEY(key));
      const obj = {
        keyId: createKeyId(key),
        pattern
      };
      if (auto) obj.searcher = createSearcher(pattern, options);
      return obj;
    }
    const node = {
      children: [],
      operator: keys[0]
    };
    keys.forEach((key) => {
      const value = query2[key];
      if (isArray(value)) value.forEach((item) => {
        node.children.push(next(item));
      });
    });
    return node;
  };
  if (!isExpression(query)) query = convertToExplicit(query);
  return next(query);
}
function computeScoreSingle(matches, { ignoreFieldNorm = Config.ignoreFieldNorm }) {
  let totalScore = 1;
  matches.forEach(({ key, norm: norm2, score }) => {
    const weight = key ? key.weight : null;
    totalScore *= Math.pow(score === 0 && weight ? Number.EPSILON : score, (weight || 1) * (ignoreFieldNorm ? 1 : norm2));
  });
  return totalScore;
}
function computeScore(results, { ignoreFieldNorm = Config.ignoreFieldNorm }) {
  results.forEach((result) => {
    result.score = computeScoreSingle(result.matches, { ignoreFieldNorm });
  });
}
var MaxHeap = class {
  constructor(limit) {
    this.limit = limit;
    this.heap = [];
  }
  get size() {
    return this.heap.length;
  }
  shouldInsert(score) {
    return this.size < this.limit || score < this.heap[0].score;
  }
  insert(item) {
    if (this.size < this.limit) {
      this.heap.push(item);
      this._bubbleUp(this.size - 1);
    } else if (item.score < this.heap[0].score) {
      this.heap[0] = item;
      this._sinkDown(0);
    }
  }
  extractSorted(sortFn) {
    return this.heap.sort(sortFn);
  }
  _bubbleUp(i) {
    const heap = this.heap;
    while (i > 0) {
      const parent = i - 1 >> 1;
      if (heap[i].score <= heap[parent].score) break;
      const tmp = heap[i];
      heap[i] = heap[parent];
      heap[parent] = tmp;
      i = parent;
    }
  }
  _sinkDown(i) {
    const heap = this.heap;
    const len = heap.length;
    let largest = i;
    do {
      i = largest;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < len && heap[left].score > heap[largest].score) largest = left;
      if (right < len && heap[right].score > heap[largest].score) largest = right;
      if (largest !== i) {
        const tmp = heap[i];
        heap[i] = heap[largest];
        heap[largest] = tmp;
      }
    } while (largest !== i);
  }
};
function formatMatches(result) {
  const matches = [];
  result.matches.forEach((match3) => {
    if (!isDefined(match3.indices) || !match3.indices.length) return;
    const obj = {
      indices: match3.indices,
      value: match3.value
    };
    if (match3.key) obj.key = match3.key.id;
    if (match3.idx > -1) obj.refIndex = match3.idx;
    matches.push(obj);
  });
  return matches;
}
function format2(results, docs, { includeMatches = Config.includeMatches, includeScore = Config.includeScore } = {}) {
  return results.map((result) => {
    const { idx } = result;
    const data = {
      item: docs[idx],
      refIndex: idx
    };
    if (includeMatches) data.matches = formatMatches(result);
    if (includeScore) data.score = result.score;
    return data;
  });
}
var DEFAULT_TOKEN = /[\p{L}\p{M}\p{N}_]+/gu;
var warned = /* @__PURE__ */ new WeakSet();
function warnNonGlobal(regex) {
  if (!warned.has(regex)) {
    warned.add(regex);
    console.warn(`[Fuse] tokenize regex ${regex} lacks the global flag; only the first match per text will be returned. Add the 'g' flag.`);
  }
}
function resolveTokenize(tokenize3) {
  if (typeof tokenize3 === "function") {
    let validated = false;
    return (text) => {
      const result = tokenize3(text);
      if (!validated) {
        validated = true;
        if (!Array.isArray(result) || result.some((t) => typeof t !== "string")) throw new Error(`[Fuse] tokenize function must return string[]; received ${Array.isArray(result) ? "array containing non-strings" : typeof result}.`);
      }
      return result;
    };
  }
  if (tokenize3 instanceof RegExp) {
    if (!tokenize3.global) warnNonGlobal(tokenize3);
    return (text) => text.match(tokenize3) || [];
  }
  return (text) => text.match(DEFAULT_TOKEN) || [];
}
function createAnalyzer({ isCaseSensitive = false, ignoreDiacritics = false, tokenize: tokenize3 } = {}) {
  const tokenizeFn = resolveTokenize(tokenize3);
  return { tokenize(text) {
    if (!isCaseSensitive) text = text.toLowerCase();
    if (ignoreDiacritics) text = stripDiacritics(text);
    return tokenizeFn(text);
  } };
}
var TokenSearch = class {
  static condition(_, options) {
    return options.useTokenSearch;
  }
  constructor(pattern, options) {
    this.options = options;
    this.analyzer = createAnalyzer({
      isCaseSensitive: options.isCaseSensitive,
      ignoreDiacritics: options.ignoreDiacritics,
      tokenize: options.tokenize
    });
    const queryTerms = this.analyzer.tokenize(pattern);
    const { df, fieldCount } = options._invertedIndex;
    this.termSearchers = [];
    this.idfWeights = [];
    for (const term of queryTerms) {
      this.termSearchers.push(new BitapSearch(term, {
        location: options.location,
        threshold: options.threshold,
        distance: options.distance,
        includeMatches: options.includeMatches,
        findAllMatches: options.findAllMatches,
        minMatchCharLength: options.minMatchCharLength,
        isCaseSensitive: options.isCaseSensitive,
        ignoreDiacritics: options.ignoreDiacritics,
        ignoreLocation: true
      }));
      const docFreq = df.get(term) || 0;
      const idf = Math.log(1 + (fieldCount - docFreq + 0.5) / (docFreq + 0.5));
      this.idfWeights.push(idf);
    }
    this.combineAll = options.tokenMatch === "all";
    this.numTerms = this.termSearchers.length;
    this.useMask = this.numTerms <= 31;
  }
  searchIn(text) {
    if (!this.termSearchers.length) return {
      isMatch: false,
      score: 1
    };
    const allIndices = [];
    let weightedScore = 0;
    let maxPossibleScore = 0;
    let matchedCount = 0;
    let matchedMask = 0;
    const matchedTerms = this.combineAll && !this.useMask ? /* @__PURE__ */ new Set() : null;
    for (let i = 0; i < this.termSearchers.length; i++) {
      const result = this.termSearchers[i].searchIn(text);
      const idf = this.idfWeights[i];
      maxPossibleScore += idf;
      if (result.isMatch) {
        matchedCount++;
        weightedScore += idf * (1 - result.score);
        if (result.indices) allIndices.push(...result.indices);
        if (this.combineAll) if (this.useMask) matchedMask |= 1 << i;
        else matchedTerms.add(i);
      }
    }
    if (matchedCount === 0) return {
      isMatch: false,
      score: 1
    };
    const normalized = maxPossibleScore > 0 ? 1 - weightedScore / maxPossibleScore : 0;
    const searchResult = {
      isMatch: true,
      score: Math.max(1e-3, normalized)
    };
    if (this.options.includeMatches && allIndices.length) searchResult.indices = mergeIndices(allIndices);
    if (this.combineAll) {
      if (this.useMask) searchResult.matchedMask = matchedMask;
      else searchResult.matchedTerms = matchedTerms;
      searchResult.termCount = this.numTerms;
    }
    return searchResult;
  }
};
function addField(index, text, docIdx, analyzer) {
  const tokens = analyzer.tokenize(text);
  if (!tokens.length) return;
  index.fieldCount++;
  index.docFieldCount.set(docIdx, (index.docFieldCount.get(docIdx) || 0) + 1);
  const distinctTerms = new Set(tokens);
  let perDocTerms = index.docTermFieldHits.get(docIdx);
  if (!perDocTerms) {
    perDocTerms = /* @__PURE__ */ new Map();
    index.docTermFieldHits.set(docIdx, perDocTerms);
  }
  for (const term of distinctTerms) {
    perDocTerms.set(term, (perDocTerms.get(term) || 0) + 1);
    index.df.set(term, (index.df.get(term) || 0) + 1);
  }
}
function ingestRecord(index, record, keyCount, analyzer) {
  const { i: docIdx, v, $: fields } = record;
  if (v !== void 0) {
    addField(index, v, docIdx, analyzer);
    return;
  }
  if (!fields) return;
  for (let keyIdx = 0; keyIdx < keyCount; keyIdx++) {
    const value = fields[keyIdx];
    if (!value) continue;
    if (Array.isArray(value)) for (const sub of value) addField(index, sub.v, docIdx, analyzer);
    else addField(index, value.v, docIdx, analyzer);
  }
}
function buildInvertedIndex(records, keyCount, analyzer) {
  const index = {
    fieldCount: 0,
    df: /* @__PURE__ */ new Map(),
    docFieldCount: /* @__PURE__ */ new Map(),
    docTermFieldHits: /* @__PURE__ */ new Map()
  };
  for (const record of records) ingestRecord(index, record, keyCount, analyzer);
  return index;
}
function addToInvertedIndex(index, record, keyCount, analyzer) {
  ingestRecord(index, record, keyCount, analyzer);
}
function removeFromInvertedIndex(index, docIdx) {
  const fieldCount = index.docFieldCount.get(docIdx);
  if (fieldCount === void 0) return;
  index.fieldCount -= fieldCount;
  index.docFieldCount.delete(docIdx);
  const perDocTerms = index.docTermFieldHits.get(docIdx);
  if (!perDocTerms) return;
  for (const [term, hits] of perDocTerms) {
    const next = (index.df.get(term) || 0) - hits;
    if (next <= 0) index.df.delete(term);
    else index.df.set(term, next);
  }
  index.docTermFieldHits.delete(docIdx);
}
function removeAndShiftInvertedIndex(index, removedIndices) {
  if (removedIndices.length === 0) return;
  const sorted = Array.from(new Set(removedIndices)).sort((a, b) => a - b);
  for (const idx of sorted) removeFromInvertedIndex(index, idx);
  const shift = (oldIdx) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (sorted[mid] < oldIdx) lo = mid + 1;
      else hi = mid;
    }
    return oldIdx - lo;
  };
  const firstRemoved = sorted[0];
  const shiftedDocFieldCount = /* @__PURE__ */ new Map();
  for (const [oldKey, count] of index.docFieldCount) shiftedDocFieldCount.set(oldKey > firstRemoved ? shift(oldKey) : oldKey, count);
  index.docFieldCount = shiftedDocFieldCount;
  const shiftedDocTermFieldHits = /* @__PURE__ */ new Map();
  for (const [oldKey, terms] of index.docTermFieldHits) shiftedDocTermFieldHits.set(oldKey > firstRemoved ? shift(oldKey) : oldKey, terms);
  index.docTermFieldHits = shiftedDocTermFieldHits;
}
var Fuse = class {
  constructor(docs, options, index) {
    this.options = {
      ...Config,
      ...options
    };
    if (this.options.useExtendedSearch && false) ;
    if (this.options.useTokenSearch && false) ;
    this._keyStore = new KeyStore(this.options.keys);
    this._docs = docs;
    this._myIndex = null;
    this._invertedIndex = null;
    this.setCollection(docs, index);
    this._lastQuery = null;
    this._lastSearcher = null;
  }
  _getSearcher(query) {
    if (this._lastQuery === query) return this._lastSearcher;
    const searcher = createSearcher(query, this._invertedIndex ? {
      ...this.options,
      _invertedIndex: this._invertedIndex
    } : this.options);
    this._lastQuery = query;
    this._lastSearcher = searcher;
    return searcher;
  }
  setCollection(docs, index) {
    this._docs = docs;
    if (index && !(index instanceof FuseIndex)) throw new Error(INCORRECT_INDEX_TYPE);
    this._myIndex = index || createIndex(this.options.keys, this._docs, {
      getFn: this.options.getFn,
      fieldNormWeight: this.options.fieldNormWeight
    });
    if (this.options.useTokenSearch) {
      const analyzer = createAnalyzer({
        isCaseSensitive: this.options.isCaseSensitive,
        ignoreDiacritics: this.options.ignoreDiacritics,
        tokenize: this.options.tokenize
      });
      this._invertedIndex = buildInvertedIndex(this._myIndex.records, this._myIndex.keys.length, analyzer);
    }
    this._invalidateSearcherCache();
  }
  add(doc) {
    if (!isDefined(doc)) return;
    this._docs.push(doc);
    const record = this._myIndex.add(doc, this._docs.length - 1);
    if (this._invertedIndex && record) {
      const analyzer = createAnalyzer({
        isCaseSensitive: this.options.isCaseSensitive,
        ignoreDiacritics: this.options.ignoreDiacritics,
        tokenize: this.options.tokenize
      });
      addToInvertedIndex(this._invertedIndex, record, this._myIndex.keys.length, analyzer);
    }
    this._invalidateSearcherCache();
  }
  remove(predicate = () => false) {
    const results = [];
    const indicesToRemove = [];
    for (let i = 0, len = this._docs.length; i < len; i += 1) if (predicate(this._docs[i], i)) {
      results.push(this._docs[i]);
      indicesToRemove.push(i);
    }
    if (indicesToRemove.length) {
      if (this._invertedIndex) removeAndShiftInvertedIndex(this._invertedIndex, indicesToRemove);
      const toRemove = new Set(indicesToRemove);
      this._docs = this._docs.filter((_, i) => !toRemove.has(i));
      this._myIndex.removeAll(indicesToRemove);
      this._invalidateSearcherCache();
    }
    return results;
  }
  removeAt(idx) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= this._docs.length) throw new Error(INVALID_DOC_INDEX);
    if (this._invertedIndex) removeAndShiftInvertedIndex(this._invertedIndex, [idx]);
    const doc = this._docs.splice(idx, 1)[0];
    this._myIndex.removeAt(idx);
    this._invalidateSearcherCache();
    return doc;
  }
  _invalidateSearcherCache() {
    this._lastQuery = null;
    this._lastSearcher = null;
  }
  getIndex() {
    return this._myIndex;
  }
  search(query, options) {
    const { limit = -1 } = options || {};
    const { includeMatches, includeScore, shouldSort, sortFn, ignoreFieldNorm } = this.options;
    if (isString(query) && !query.trim()) {
      let docs = this._docs.map((item, idx) => ({
        item,
        refIndex: idx
      }));
      if (isNumber(limit) && limit > -1) docs = docs.slice(0, limit);
      return docs;
    }
    const useHeap = isNumber(limit) && limit > 0 && isString(query);
    let results;
    if (useHeap) {
      const heap = new MaxHeap(limit);
      if (isString(this._docs[0])) this._searchStringList(query, {
        heap,
        ignoreFieldNorm
      });
      else this._searchObjectList(query, {
        heap,
        ignoreFieldNorm
      });
      results = heap.extractSorted(sortFn);
    } else {
      results = isString(query) ? isString(this._docs[0]) ? this._searchStringList(query) : this._searchObjectList(query) : this._searchLogical(query);
      computeScore(results, { ignoreFieldNorm });
      if (shouldSort) results.sort(sortFn);
      if (isNumber(limit) && limit > -1) results = results.slice(0, limit);
    }
    return format2(results, this._docs, {
      includeMatches,
      includeScore
    });
  }
  _searchStringList(query, { heap, ignoreFieldNorm } = {}) {
    const searcher = this._getSearcher(query);
    const requireAllTokens = this.options.useTokenSearch && this.options.tokenMatch === "all";
    const { records } = this._myIndex;
    const results = heap ? null : [];
    records.forEach(({ v: text, i: idx, n: norm2 }) => {
      if (!isDefined(text)) return;
      const searchResult = searcher.searchIn(text);
      if (searchResult.isMatch) {
        const match3 = {
          score: searchResult.score,
          value: text,
          norm: norm2,
          indices: searchResult.indices
        };
        if (requireAllTokens) {
          match3.matchedMask = searchResult.matchedMask;
          match3.matchedTerms = searchResult.matchedTerms;
          match3.termCount = searchResult.termCount;
        }
        const matches = [match3];
        if (!requireAllTokens || this._coversAllTokens(matches)) {
          const result = {
            item: text,
            idx,
            matches
          };
          if (heap) {
            result.score = computeScoreSingle(result.matches, { ignoreFieldNorm });
            if (heap.shouldInsert(result.score)) heap.insert(result);
          } else results.push(result);
        }
      }
    });
    return results;
  }
  _searchLogical(query) {
    const expression = parse(query, this.options);
    const evaluate = (node, item, idx) => {
      if (!("children" in node)) {
        const { keyId, searcher } = node;
        let matches;
        if (keyId === null) {
          matches = [];
          this._myIndex.keys.forEach((key, keyIndex) => {
            matches.push(...this._findMatches({
              key,
              value: item[keyIndex],
              searcher
            }));
          });
        } else matches = this._findMatches({
          key: this._keyStore.get(keyId),
          value: this._myIndex.getValueForItemAtKeyId(item, keyId),
          searcher
        });
        if (matches && matches.length) return [{
          idx,
          item,
          matches
        }];
        return [];
      }
      const { children, operator } = node;
      const res = [];
      for (let i = 0, len = children.length; i < len; i += 1) {
        const child = children[i];
        const result = evaluate(child, item, idx);
        if (result.length) res.push(...result);
        else if (operator === LogicalOperator.AND) return [];
      }
      return res;
    };
    const records = this._myIndex.records;
    const resultMap = /* @__PURE__ */ new Map();
    const results = [];
    records.forEach(({ $: item, i: idx }) => {
      if (isDefined(item)) {
        const expResults = evaluate(expression, item, idx);
        if (expResults.length) {
          if (!resultMap.has(idx)) {
            resultMap.set(idx, {
              idx,
              item,
              matches: []
            });
            results.push(resultMap.get(idx));
          }
          expResults.forEach(({ matches }) => {
            resultMap.get(idx).matches.push(...matches);
          });
        }
      }
    });
    return results;
  }
  _searchObjectList(query, { heap, ignoreFieldNorm } = {}) {
    const searcher = this._getSearcher(query);
    const requireAllTokens = this.options.useTokenSearch && this.options.tokenMatch === "all";
    const { keys, records } = this._myIndex;
    const results = heap ? null : [];
    records.forEach(({ $: item, i: idx }) => {
      if (!isDefined(item)) return;
      const matches = [];
      let anyKeyFailed = false;
      let hasInverse = false;
      keys.forEach((key, keyIndex) => {
        const keyMatches = this._findMatches({
          key,
          value: item[keyIndex],
          searcher
        });
        if (keyMatches.length) {
          matches.push(...keyMatches);
          if (keyMatches[0].hasInverse) hasInverse = true;
        } else anyKeyFailed = true;
      });
      if (hasInverse && anyKeyFailed) return;
      if (matches.length && (!requireAllTokens || this._coversAllTokens(matches))) {
        const result = {
          idx,
          item,
          matches
        };
        if (heap) {
          result.score = computeScoreSingle(result.matches, { ignoreFieldNorm });
          if (heap.shouldInsert(result.score)) heap.insert(result);
        } else results.push(result);
      }
    });
    return results;
  }
  _findMatches({ key, value, searcher }) {
    if (!isDefined(value)) return [];
    const matches = [];
    if (isArray(value)) value.forEach(({ v: text, i: idx, n: norm2 }) => {
      if (!isDefined(text)) return;
      const searchResult = searcher.searchIn(text);
      if (searchResult.isMatch) {
        const match3 = {
          score: searchResult.score,
          key,
          value: text,
          idx,
          norm: norm2,
          indices: searchResult.indices,
          hasInverse: searchResult.hasInverse
        };
        if (searchResult.termCount !== void 0) {
          match3.matchedMask = searchResult.matchedMask;
          match3.matchedTerms = searchResult.matchedTerms;
          match3.termCount = searchResult.termCount;
        }
        matches.push(match3);
      }
    });
    else {
      const { v: text, n: norm2 } = value;
      const searchResult = searcher.searchIn(text);
      if (searchResult.isMatch) {
        const match3 = {
          score: searchResult.score,
          key,
          value: text,
          norm: norm2,
          indices: searchResult.indices,
          hasInverse: searchResult.hasInverse
        };
        if (searchResult.termCount !== void 0) {
          match3.matchedMask = searchResult.matchedMask;
          match3.matchedTerms = searchResult.matchedTerms;
          match3.termCount = searchResult.termCount;
        }
        matches.push(match3);
      }
    }
    return matches;
  }
  _coversAllTokens(matches) {
    const termCount = matches.length ? matches[0].termCount : void 0;
    if (termCount === void 0) return true;
    if (termCount <= 31) {
      let coverage2 = 0;
      for (let i = 0; i < matches.length; i++) coverage2 |= matches[i].matchedMask || 0;
      return coverage2 === 2 ** termCount - 1;
    }
    const coverage = /* @__PURE__ */ new Set();
    for (let i = 0; i < matches.length; i++) {
      const terms = matches[i].matchedTerms;
      if (terms) for (const t of terms) coverage.add(t);
    }
    return coverage.size === termCount;
  }
};
Fuse.version = "7.4.2";
Fuse.createIndex = createIndex;
Fuse.parseIndex = parseIndex;
Fuse.config = Config;
Fuse.match = function(pattern, text, options) {
  if (options && options.useTokenSearch) throw new Error(FUSE_MATCH_TOKEN_SEARCH_UNSUPPORTED);
  return createSearcher(pattern, {
    ...Config,
    ...options
  }).searchIn(text);
};
Fuse.parseQuery = parse;
register(ExtendedSearch);
register(TokenSearch);
Fuse.use = function(...plugins) {
  plugins.forEach((plugin) => register(plugin));
};
var entry_default = Fuse;

// src/lib/search.ts
function toSearchable(members) {
  return members.map((m) => ({
    ...m,
    _search: m.searchName || normalizeText(m.fullName),
    _aliasSearch: (m.aliases || []).map(normalizeText).join(" ")
  }));
}
function buildFuse(members) {
  return new entry_default(members, {
    includeScore: true,
    ignoreLocation: true,
    // el término puede aparecer en cualquier parte
    threshold: 0.4,
    // tolerante a errores de tipeo
    minMatchCharLength: 2,
    keys: [
      { name: "_search", weight: 0.7 },
      { name: "_aliasSearch", weight: 0.3 }
    ]
  });
}
function intersect(a, b) {
  const out = /* @__PURE__ */ new Set();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}
function searchMembers(fuse, all, query, limit = 30) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const hits = /* @__PURE__ */ new Map();
  const scoreById = /* @__PURE__ */ new Map();
  let candidateIds = null;
  for (const token of tokens) {
    let ids;
    if (token.length < 2) {
      ids = new Set(
        all.filter(
          (m) => m._search.includes(token) || m._aliasSearch.includes(token)
        ).map((m) => m.id)
      );
    } else {
      ids = /* @__PURE__ */ new Set();
      for (const r of fuse.search(token)) {
        ids.add(r.item.id);
        const s = r.score ?? 1;
        scoreById.set(r.item.id, (scoreById.get(r.item.id) ?? 0) + s);
      }
    }
    for (const id of ids) hits.set(id, (hits.get(id) ?? 0) + 1);
    candidateIds = candidateIds ? intersect(candidateIds, ids) : ids;
  }
  const byId = new Map(all.map((m) => [m.id, m]));
  const ordenar = (ids) => [...ids].map((id) => byId.get(id)).filter((m) => Boolean(m)).sort(
    (a, b) => (hits.get(b.id) ?? 0) - (hits.get(a.id) ?? 0) || (scoreById.get(a.id) ?? 1) - (scoreById.get(b.id) ?? 1) || a.fullName.localeCompare(b.fullName, "es")
  ).slice(0, limit);
  if (candidateIds && candidateIds.size > 0) return ordenar(candidateIds);
  const largas = tokens.filter((t) => t.length >= 2).length;
  if (largas < 2) return [];
  const casi = [...hits].filter(([, n]) => n >= tokens.length - 1).map(([id]) => id);
  const out = ordenar(casi);
  out.partial = out.length > 0;
  return out;
}
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
function sameWord(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return editDistance(a, b, 1) <= 1;
}
function findSimilarMembers(members, name, limit = 6) {
  const buscado = normalizeText(name);
  const palabras = buscado.split(" ").filter((w) => w.length >= 2);
  if (palabras.length === 0) return [];
  const necesarias = Math.min(2, palabras.length);
  const out = [];
  for (const m of members) {
    const propio = m.searchName || normalizeText(m.fullName);
    const nombres = [propio, ...(m.aliases ?? []).map(normalizeText)];
    let mejor = 0;
    let exacto = false;
    let fichaCorta = false;
    for (const n of nombres) {
      if (n === buscado) exacto = true;
      const suyas = n.split(" ").filter(Boolean);
      const matched = palabras.length === 1 ? suyas.length > 0 && sameWord(palabras[0], suyas[0]) ? 1 : 0 : palabras.filter((w) => suyas.some((s) => sameWord(w, s))).length;
      if (matched > mejor) mejor = matched;
      if (suyas.length === 1 && palabras.length > 1 && sameWord(palabras[0], suyas[0])) {
        fichaCorta = true;
      }
    }
    if (exacto || mejor >= necesarias || fichaCorta) {
      out.push({ member: m, exact: exacto, matched: exacto ? palabras.length : mejor });
    }
  }
  return out.sort(
    (a, b) => Number(b.exact) - Number(a.exact) || b.matched - a.matched || a.member.fullName.localeCompare(b.member.fullName, "es")
  ).slice(0, limit);
}

// src/lib/ids.ts
function hashCorto(s) {
  let a = 2166136261;
  let b = 16777619 ^ 1540483477;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 16777629) >>> 0;
  }
  return a.toString(36) + b.toString(36);
}
var walkinId = (sessionId, searchName) => `p_${hashCorto(`${sessionId}|${searchName}`)}`;
var sessionIdDelDia = (type, dia) => `${type}-${dia}`;

// src/lib/activity.ts
var GROUP_ORDER = [
  "firmes",
  "nuevas",
  "irregulares",
  "alejandose",
  "dormidas"
];
function buildActivityReport(sessions, attendance, type, ventana, hoy = /* @__PURE__ */ new Date()) {
  const finDeHoy = endOfTodayBogota(hoy).getTime() - 1;
  const presentesDe = /* @__PURE__ */ new Map();
  for (const a of attendance) {
    if (a.sessionType !== type) continue;
    if (toDate2(a.sessionDate).getTime() > finDeHoy) continue;
    let set = presentesDe.get(a.sessionId);
    if (!set) presentesDe.set(a.sessionId, set = /* @__PURE__ */ new Set());
    set.add(a.memberId);
  }
  const porDia = /* @__PURE__ */ new Map();
  for (const s of sessions) {
    if (s.type !== type || toDate2(s.date).getTime() > finDeHoy) continue;
    const gente = presentesDe.get(s.id);
    if (!gente || gente.size === 0) continue;
    const k = dayKey(s.date);
    const r = porDia.get(k);
    if (!r) {
      porDia.set(k, { session: s, ids: /* @__PURE__ */ new Set([s.id]), gente: new Set(gente) });
    } else {
      r.ids.add(s.id);
      gente.forEach((m) => r.gente.add(m));
      if (gente.size > (presentesDe.get(r.session.id)?.size ?? 0)) r.session = s;
    }
  }
  const realizadas2 = [...porDia.values()].sort(
    (a, b) => toDate2(b.session.date).getTime() - toDate2(a.session.date).getTime()
  );
  const recientesS = realizadas2.slice(0, ventana);
  const previasS = realizadas2.slice(ventana, ventana * 2);
  const diaReciente = /* @__PURE__ */ new Map();
  const diaPrevio = /* @__PURE__ */ new Map();
  for (const r of recientesS) r.ids.forEach((id) => diaReciente.set(id, dayKey(r.session.date)));
  for (const r of previasS) r.ids.forEach((id) => diaPrevio.set(id, dayKey(r.session.date)));
  const mapa = /* @__PURE__ */ new Map();
  for (const a of attendance) {
    if (a.sessionType !== type) continue;
    const fecha = toDate2(a.sessionDate);
    if (fecha.getTime() > finDeHoy) continue;
    let p = mapa.get(a.memberId);
    if (!p) {
      p = {
        memberId: a.memberId,
        fullName: a.fullName,
        recientes: 0,
        previas: 0,
        primera: fecha,
        ultima: fecha,
        grupo: "dormidas",
        _rec: /* @__PURE__ */ new Set(),
        _prev: /* @__PURE__ */ new Set()
      };
      mapa.set(a.memberId, p);
    }
    if (fecha.getTime() >= p.ultima.getTime()) {
      p.ultima = fecha;
      p.fullName = a.fullName;
    }
    if (fecha.getTime() < p.primera.getTime()) p.primera = fecha;
    const dr = diaReciente.get(a.sessionId);
    const dp = diaPrevio.get(a.sessionId);
    if (dr) p._rec.add(dr);
    else if (dp) p._prev.add(dp);
  }
  for (const p of mapa.values()) {
    p.recientes = p._rec.size;
    p.previas = p._prev.size;
  }
  const umbralFirmes = Math.max(1, Math.ceil(recientesS.length * 0.6));
  const inicioVentana = recientesS.length ? toDate2(recientesS[recientesS.length - 1].session.date).getTime() : null;
  const inicioMitad = recientesS.length ? toDate2(
    recientesS[Math.ceil(recientesS.length / 2) - 1].session.date
  ).getTime() : null;
  const puedeDetectarNuevas = previasS.length > 0;
  const grupos = {
    nuevas: 0,
    firmes: 0,
    irregulares: 0,
    alejandose: 0,
    dormidas: 0
  };
  for (const p of mapa.values()) {
    if (p.recientes > 0) {
      if (puedeDetectarNuevas && inicioVentana !== null && inicioMitad !== null && p.primera.getTime() >= inicioVentana && p.ultima.getTime() >= inicioMitad) {
        p.grupo = "nuevas";
      } else if (p.recientes >= umbralFirmes) {
        p.grupo = "firmes";
      } else {
        p.grupo = "irregulares";
      }
    } else if (p.previas > 0) {
      p.grupo = "alejandose";
    } else {
      p.grupo = "dormidas";
    }
    grupos[p.grupo]++;
  }
  const personas = [...mapa.values()].map(({ _rec: _r, _prev: _p, ...p }) => p).sort(
    (a, b) => GROUP_ORDER.indexOf(a.grupo) - GROUP_ORDER.indexOf(b.grupo) || b.recientes - a.recientes || b.ultima.getTime() - a.ultima.getTime() || a.fullName.localeCompare(b.fullName, "es")
  );
  let totalRec = 0;
  let totalPrev = 0;
  let activas = 0;
  let activasPrevias = 0;
  for (const p of personas) {
    totalRec += p.recientes;
    totalPrev += p.previas;
    if (p.recientes > 0) activas++;
    if (p.previas > 0) activasPrevias++;
  }
  return {
    type,
    ventana,
    // De la más antigua a la más nueva: así se lee la tendencia de izquierda
    // a derecha, como en el gráfico por mes del resumen.
    recientes: [...recientesS].reverse().map((r) => ({
      session: r.session,
      presentes: r.gente.size
    })),
    previasCount: previasS.length,
    desde: recientesS.length ? toDate2(recientesS[recientesS.length - 1].session.date) : null,
    hasta: recientesS.length ? toDate2(recientesS[0].session.date) : null,
    activas,
    activasPrevias,
    activasComparables: previasS.length > 0 && previasS.length === recientesS.length,
    promedio: recientesS.length ? totalRec / recientesS.length : 0,
    promedioPrevio: previasS.length ? totalPrev / previasS.length : 0,
    umbralFirmes,
    puedeDetectarNuevas,
    personas,
    grupos
  };
}
var GRUPO_TITULO = {
  firmes: "Firmes",
  nuevas: "Nuevas",
  irregulares: "Van y vienen",
  alejandose: "Se est\xE1n alejando",
  dormidas: "Hace rato no vienen"
};
function resumenActividad(r, conNombres = true) {
  if (r.recientes.length === 0) {
    return `Todav\xEDa no hay reuniones registradas de ${SESSION_TYPE_LABELS[r.type]}.`;
  }
  const n = r.recientes.length;
  const cmp = (actual, previo) => {
    if (r.previasCount === 0) return " (no hay per\xEDodo anterior con qu\xE9 comparar)";
    const d = Math.round((actual - previo) * 10) / 10;
    if (d === 0) return " (igual que en el per\xEDodo anterior)";
    return ` (${d > 0 ? "+" : ""}${d} frente al per\xEDodo anterior)`;
  };
  const lineas = [
    `${SESSION_TYPE_LABELS[r.type]} \u2014 \xFAltimas ${n} reuniones (${fmtDate(r.desde)} a ${fmtDate(r.hasta)})`,
    "",
    `PERSONAS DISTINTAS QUE VINIERON: ${r.activas}${r.activasComparables || r.previasCount === 0 ? cmp(r.activas, r.activasPrevias) : ` (el per\xEDodo anterior solo tuvo ${r.previasCount} reuni\xF3n(es): no es comparable)`}`,
    `Promedio de presentes por reuni\xF3n: ${Math.round(r.promedio * 10) / 10}${cmp(
      r.promedio,
      r.promedioPrevio
    )}`,
    "",
    "Grupos:",
    `  Firmes (vinieron ${r.umbralFirmes}+ de ${n}): ${r.grupos.firmes}`,
    `  Nuevas (primera vez y siguen viniendo): ${r.grupos.nuevas}${r.puedeDetectarNuevas ? "" : " \u2014 sin historial anterior, no se puede saber"}`,
    `  Van y vienen: ${r.grupos.irregulares}`,
    `  Se est\xE1n alejando (ven\xEDan antes, ahora no): ${r.grupos.alejandose}`,
    `  Hace rato no vienen: ${r.grupos.dormidas}`,
    "",
    "Asistentes por reuni\xF3n:",
    ...r.recientes.map(
      ({ session, presentes }) => `  ${fmtDate(session.date)} (${MODALITY_LABELS[session.modality]}): ${presentes}`
    )
  ];
  if (conNombres) {
    for (const g of ["firmes", "nuevas", "irregulares", "alejandose"]) {
      const gente = r.personas.filter((p) => p.grupo === g);
      if (gente.length === 0) continue;
      lineas.push("", `${GRUPO_TITULO[g]}:`);
      for (const p of gente) {
        lineas.push(
          p.recientes > 0 ? `  - ${p.fullName} \u2014 vino ${p.recientes} de ${n}` : `  - ${p.fullName} \u2014 \xFAltima vez ${fmtDate(p.ultima)}`
        );
      }
    }
  }
  return lineas.join("\n");
}

// mcp/src/informes.ts
var TIPOS = {
  pasos: "entrega_pasos",
  ego: "reduccion_ego"
};
function realizadas(sessions, hoy) {
  const hoyKey = dayKey(hoy);
  return sessions.filter((s) => dayKey(s.date) <= hoyKey);
}
function informeComoVamos(sessions, attendance, tipo, ventana, conNombres, hoy = /* @__PURE__ */ new Date()) {
  return resumenActividad(
    buildActivityReport(sessions, attendance, TIPOS[tipo], ventana, hoy),
    conNombres
  );
}
function informeConteos(sessions, personas, hoy = /* @__PURE__ */ new Date()) {
  const hechas = realizadas(sessions, hoy);
  const porTipo = (t) => hechas.filter((s) => s.type === t).length;
  const oficiales = personas.filter((p) => !p.pendingReview);
  return [
    `Personas en la lista oficial: ${oficiales.filter((p) => p.active !== false).length} activas de ${oficiales.length}`,
    `Esperando revisi\xF3n (agregadas en una reuni\xF3n): ${personas.filter((p) => p.pendingReview).length}`,
    `Sin nombre todav\xEDa ("Por identificar"): ${personas.filter((p) => p.pendingIdentify).length}`,
    `Reuniones realizadas: ${hechas.length} (Pasos: ${porTipo("entrega_pasos")}, Ego: ${porTipo("reduccion_ego")})`,
    `Reuniones agendadas a futuro: ${sessions.length - hechas.length}`,
    `Sesiones abiertas ahora mismo: ${sessions.filter((s) => s.status === "open").length}`
  ].join("\n");
}
function informeReuniones(sessions, attendance, tipo, limite, hoy = /* @__PURE__ */ new Date()) {
  const presentes = /* @__PURE__ */ new Map();
  for (const a of attendance) {
    presentes.set(a.sessionId, (presentes.get(a.sessionId) ?? 0) + 1);
  }
  const delTipo = sessions.filter((s) => tipo === "todas" || s.type === TIPOS[tipo]).sort((a, b) => toDate2(b.date).getTime() - toDate2(a.date).getTime());
  if (delTipo.length === 0) return "No hay reuniones registradas.";
  const hoyKey = dayKey(hoy);
  const hechas = delTipo.filter((s) => dayKey(s.date) <= hoyKey).slice(0, limite);
  const proximas = delTipo.filter((s) => dayKey(s.date) > hoyKey).reverse().slice(0, limite);
  const linea = (s) => {
    const n = presentes.get(s.id) ?? 0;
    const futura = dayKey(s.date) > hoyKey;
    return `${fmtDate(s.date)} \xB7 ${SESSION_TYPE_LABELS[s.type]} \xB7 ${MODALITY_LABELS[s.modality]} \xB7 ` + // Una reunión agendada saldría como "0 presentes", que se lee igual que
    // "no fue nadie". Y si ya tiene gente marcada, algo se marcó por error.
    (futura ? n > 0 ? `\u26A0\uFE0F AGENDADA pero ya tiene ${n} presentes (\xBFse marc\xF3 en la reuni\xF3n equivocada?)` : "AGENDADA (todav\xEDa no ocurre)" : `${n} presentes`) + (s.coordinator ? ` \xB7 coordin\xF3 ${s.coordinator}` : "") + (s.status === "open" ? daysFromToday(s.date, hoy) < -1 ? " \xB7 \u26A0\uFE0F SIGUE ABIERTA (falta cerrarla)" : " \xB7 ABIERTA" : "") + `
  id: ${s.id}`;
  };
  return [
    ...hechas.length ? ["Recientes:", ...hechas.map(linea)] : ["Todav\xEDa no hay reuniones realizadas."],
    ...proximas.length ? ["", "Agendadas:", ...proximas.map(linea)] : []
  ].join("\n");
}
function informeAsistenciaReunion(s, asistentes, reunionId) {
  if (!s) return `No existe ninguna reuni\xF3n con id ${reunionId}.`;
  const gente = [...asistentes].sort((a, b) => a.fullName.localeCompare(b.fullName, "es"));
  return [
    `${SESSION_TYPE_LABELS[s.type]} \u2014 ${fmtDate(s.date)} \xB7 ${MODALITY_LABELS[s.modality]}` + (s.coordinator ? ` \xB7 coordin\xF3 ${s.coordinator}` : ""),
    `${gente.length} presentes:`,
    ...gente.map((a) => `  - ${a.fullName}`)
  ].join("\n");
}
function informeBuscarPersona(personas, nombre) {
  const todas = toSearchable(personas);
  const encontradas = searchMembers(buildFuse(todas), todas, nombre, 25);
  if (encontradas.length === 0) {
    return `Nadie coincide con "${nombre}". Antes de crear una ficha nueva, prueba con solo el primer nombre o solo el apellido.`;
  }
  return [
    ...encontradas.partial ? [`Nadie coincide con todo "${nombre}". Estas personas coinciden en casi todo:`, ""] : [],
    ...encontradas.map(
      (p) => `${p.fullName}` + (p.aliases?.length ? ` (tambi\xE9n: ${p.aliases.join(", ")})` : "") + (p.active === false ? " (inactiva)" : "") + (p.pendingReview ? " (esperando revisi\xF3n)" : "") + (p.pendingIdentify ? " (sin nombre confirmado)" : "") + `
  id: ${p.id}`
    )
  ].join("\n");
}
function informeHistorial(sessions, attendance, personas, personaId, hoy = /* @__PURE__ */ new Date()) {
  const persona2 = personas.find((p) => p.id === personaId);
  const suyas = attendance.filter((a) => a.memberId === personaId).sort((a, b) => toDate2(b.sessionDate).getTime() - toDate2(a.sessionDate).getTime());
  if (!persona2 && suyas.length === 0) {
    return `No existe ninguna persona con id ${personaId}.`;
  }
  const nombre = persona2?.fullName ?? suyas[0]?.fullName ?? personaId;
  const cuenta = (t) => suyas.filter((a) => a.sessionType === t).length;
  const hechas = (t) => {
    const propias = suyas.filter((a) => a.sessionType === t);
    if (propias.length === 0) return 0;
    const desde = dayKey(propias[propias.length - 1].sessionDate);
    return realizadas(sessions, hoy).filter((s) => s.type === t && dayKey(s.date) >= desde).length;
  };
  const pct = (h, total) => total > 0 ? ` (${Math.round(Math.min(h, total) / total * 100)}% de las ${total} desde que lleg\xF3)` : "";
  return [
    `${nombre}`,
    `Total de asistencias: ${suyas.length}`,
    `  Entrega de Pasos: ${cuenta("entrega_pasos")}${pct(cuenta("entrega_pasos"), hechas("entrega_pasos"))}`,
    `  Reducci\xF3n del Ego: ${cuenta("reduccion_ego")}${pct(cuenta("reduccion_ego"), hechas("reduccion_ego"))}`,
    suyas.length ? `\xDAltima vez: ${fmtDate(suyas[0].sessionDate)}` : "",
    suyas.length ? `Primera vez: ${fmtDate(suyas[suyas.length - 1].sessionDate)}` : "",
    "",
    "Historial:",
    ...suyas.map(
      (a) => `  ${fmtDate(a.sessionDate)} \xB7 ${SESSION_TYPE_LABELS[a.sessionType]} \xB7 ${MODALITY_LABELS[a.modality]}`
    )
  ].filter(Boolean).join("\n");
}
function informePorRevisar(personas) {
  const ficha = (p) => `${p.fullName}` + (p.pendingIdentify ? " (sin nombre confirmado)" : "") + (p.createdByName ? ` \xB7 la registr\xF3 ${p.createdByName}` : "") + (p.sourceSessionDate ? ` \xB7 el ${fmtDate(p.sourceSessionDate)}` : "") + `
  id: ${p.id}`;
  const porRevisar = personas.filter((p) => p.pendingReview);
  const sinNombre = personas.filter((p) => !p.pendingReview && p.pendingIdentify);
  if (porRevisar.length === 0 && sinNombre.length === 0) {
    return "No hay nadie esperando revisi\xF3n.";
  }
  return [
    porRevisar.length ? `Esperando revisi\xF3n (${porRevisar.length}):` : "No hay nadie esperando revisi\xF3n.",
    ...porRevisar.map(ficha),
    ...sinNombre.length ? [
      "",
      `Ya en la lista pero SIN nombre real (${sinNombre.length}) \u2014 se corrigen en la app, Personas \u2192 Editar:`,
      ...sinNombre.map(ficha)
    ] : []
  ].join("\n");
}

// mcp/src/escrituras.ts
var VIGENCIA_MS = 15 * 6e4;
var huella = (json) => createHash("sha256").update(json).digest("base64url").slice(0, 16);
function empaquetar(o) {
  const json = JSON.stringify(o);
  return `${Buffer.from(json, "utf8").toString("base64url")}.${huella(json)}`;
}
function desempaquetar(id, uid) {
  const [cuerpo, firma] = id.trim().split(".");
  let json = "";
  let o;
  try {
    json = Buffer.from(cuerpo ?? "", "base64url").toString("utf8");
    o = JSON.parse(json);
  } catch {
    throw new AccesoError("Ese identificador de confirmaci\xF3n no es v\xE1lido. Prepara la operaci\xF3n de nuevo.");
  }
  if (!firma || firma !== huella(json)) {
    throw new AccesoError(
      "Ese identificador de confirmaci\xF3n lleg\xF3 alterado (\xBFse copi\xF3 incompleto?). No se ejecut\xF3 nada: prepara la operaci\xF3n de nuevo."
    );
  }
  if (o.uid !== uid) {
    throw new AccesoError("Esa operaci\xF3n la prepar\xF3 otra cuenta. Prep\xE1rala de nuevo.");
  }
  if (typeof o.exp !== "number" || Date.now() > o.exp) {
    throw new AccesoError("El borrador caduc\xF3 (dura 15 minutos). Prep\xE1ralo de nuevo.");
  }
  return o;
}
function borrador(uid, op, args, resumen) {
  const o = { op, args, uid, exp: Date.now() + VIGENCIA_MS };
  return [
    "BORRADOR \u2014 todav\xEDa no se ha guardado nada.",
    "",
    resumen,
    "",
    'Si est\xE1 bien, conf\xEDrmalo con la herramienta "confirmar_operacion" usando:',
    `confirmacion_id: ${empaquetar(o)}`,
    "",
    "Caduca en 15 minutos."
  ].join("\n");
}
function idNuevo() {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 20; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
var ID_VALIDO = /^[A-Za-z0-9_-]{1,80}$/;
function idDe(v, que) {
  const s = String(v ?? "").trim();
  if (!ID_VALIDO.test(s)) throw new AccesoError(`El id de ${que} ("${s}") no es v\xE1lido.`);
  return s;
}
function tipoDe(v) {
  if (v === "pasos" || v === "ego") return v;
  throw new AccesoError('El tipo tiene que ser "pasos" o "ego".');
}
function modalidadDe(v) {
  if (MODALITIES.includes(String(v))) return v;
  throw new AccesoError('La modalidad tiene que ser "presencial" o "virtual".');
}
function fechaDe(v) {
  const s = String(v ?? "").trim();
  if (!isValidDateKey(s)) throw new AccesoError(`La fecha "${s}" no se entiende. Usa AAAA-MM-DD.`);
  return s;
}
async function reunion(c, id) {
  const s = await c.leer(`sessions/${id}`);
  if (!s) {
    throw new AccesoError(
      `No existe ninguna reuni\xF3n con id ${id}. B\xFAscala con la herramienta "reuniones".`
    );
  }
  return s;
}
async function persona(c, id) {
  const p = await c.leer(`members/${id}`);
  if (!p) {
    throw new AccesoError(
      `No existe ninguna persona con id ${id} (quiz\xE1 la unieron con otra ficha). B\xFAscala de nuevo con "buscar_persona".`
    );
  }
  return p;
}
var describir = (s) => `${SESSION_TYPE_LABELS[s.type]} del ${fmtDate(s.date)} (${MODALITY_LABELS[s.modality]})`;
function exigirQueYaOcurrio(s) {
  if (daysFromToday(s.date) > 0) {
    throw new AccesoError(
      `Esa reuni\xF3n es del ${fmtDate(s.date)}: todav\xEDa no ha ocurrido, as\xED que no se puede tomar lista en ella. Revisa el id con la herramienta "reuniones".`
    );
  }
}
function avisoSiSigueAbierta(s) {
  return s.status === "open" && daysFromToday(s.date) < 0 ? [
    "",
    'Esta reuni\xF3n sigue ABIERTA aunque ya pas\xF3. Cuando termines de pasar la lista, ci\xE9rrala con "preparar_cerrar_reunion".'
  ] : [];
}
async function presentesEn(c, reunionId) {
  return (await c.asistenciaDe(reunionId)).length;
}
function asistenciaNueva(c, s, memberId, fullName) {
  return {
    memberId,
    fullName,
    status: "present",
    checkedInAt: /* @__PURE__ */ new Date(),
    checkedInBy: c.uid,
    checkedInByName: c.nombre,
    sessionId: s.id,
    sessionType: s.type,
    modality: s.modality,
    sessionDate: toDate2(s.date)
  };
}
async function prepararCrearReunion(c, tipoRaw, modalidadRaw, fechaRaw, coordinadora, otraMas = false) {
  const tipo = tipoDe(tipoRaw);
  const modalidad = modalidadDe(modalidadRaw);
  const fecha = fechaDe(fechaRaw);
  const type = TIPOS[tipo];
  const d = sessionDateFromKey(fecha);
  olvidar(c.uid);
  const yaHay = (await c.cargarSesiones()).filter(
    (s) => s.type === type && dayKey(s.date) === fecha
  );
  if (yaHay.length && !otraMas) {
    throw new AccesoError(
      [
        `Ya existe una reuni\xF3n de ${SESSION_TYPE_LABELS[type]} el ${fmtDate(d)}:`,
        ...yaHay.map((s) => `  id: ${s.id}${s.status === "open" ? " (abierta)" : " (cerrada)"}`),
        "Usa esa; no hace falta crear otra. Si de verdad es OTRA reuni\xF3n el mismo d\xEDa, prepara de nuevo con otra_mas=true."
      ].join("\n")
    );
  }
  const id = yaHay.length ? idNuevo() : sessionIdDelDia(type, fecha);
  const dias = daysFromToday(d);
  return borrador(
    c.uid,
    "crear_reunion",
    { id, tipo, modalidad, fecha, coordinadora: (coordinadora ?? "").trim() },
    [
      `Crear reuni\xF3n de ${SESSION_TYPE_LABELS[type]}`,
      `  Fecha: ${fmtDate(d)}`,
      `  Modalidad: ${MODALITY_LABELS[modalidad]}`,
      `  Coordina: ${coordinadora?.trim() || "sin asignar"}`,
      `  Queda ABIERTA para tomar asistencia.`,
      ...yaHay.length ? ["", `\u26A0\uFE0F Ser\xE1 la reuni\xF3n n\xFAmero ${yaHay.length + 1} de ese tipo ese d\xEDa.`] : [],
      ...dias < 0 ? [
        "",
        'Es de un d\xEDa que ya pas\xF3: despu\xE9s de pasar la lista, ci\xE9rrala con "preparar_cerrar_reunion" para que nadie la siga modificando.'
      ] : [],
      ...dias > 0 ? ["", "Queda AGENDADA: no se podr\xE1 tomar lista en ella hasta ese d\xEDa."] : []
    ].join("\n")
  );
}
async function prepararMarcar(c, reunionRaw, personaRaw, quitar) {
  const reunionId = idDe(reunionRaw, "la reuni\xF3n");
  const personaId = idDe(personaRaw, "la persona");
  const [sesion, ficha, registro] = await Promise.all([
    reunion(c, reunionId),
    persona(c, personaId),
    c.leer(`sessions/${reunionId}/attendance/${personaId}`)
  ]);
  if (!quitar) exigirQueYaOcurrio(sesion);
  if (quitar && !registro) throw new AccesoError(`${ficha.fullName} no figura en esa reuni\xF3n.`);
  if (!quitar && registro) throw new AccesoError(`${ficha.fullName} ya figura como presente.`);
  return borrador(
    c.uid,
    quitar ? "quitar_presente" : "marcar_presente",
    { reunionId, personaId },
    [
      quitar ? "QUITAR de la lista de asistencia:" : "MARCAR como presente:",
      `  ${ficha.fullName}` + (ficha.pendingReview ? " (por revisar)" : "") + (ficha.active === false ? " (ficha inactiva)" : ""),
      `  en ${describir(sesion)}`,
      ...sesion.status === "closed" ? ["", "Esa reuni\xF3n est\xE1 CERRADA; se corrige igual por ser administraci\xF3n."] : []
    ].join("\n")
  );
}
async function prepararAgregarParticipante(c, reunionRaw, nombreRaw) {
  const reunionId = idDe(reunionRaw, "la reuni\xF3n");
  const parts = buildNameParts(String(nombreRaw ?? ""));
  if (parts.fullName.length < 3) throw new AccesoError("El nombre es demasiado corto.");
  if (parts.fullName.startsWith(UNKNOWN_PREFIX)) {
    throw new AccesoError("Hace falta el nombre de la persona (aunque sea solo el primer nombre).");
  }
  const sesion = await reunion(c, reunionId);
  exigirQueYaOcurrio(sesion);
  const [asistentes, personas] = await Promise.all([c.asistenciaDe(reunionId), c.cargarPersonas()]);
  const yaEnLaReunion = asistentes.find((a) => normalizeText(a.fullName) === parts.searchName);
  if (yaEnLaReunion) throw new AccesoError(`${yaEnLaReunion.fullName} ya figura en esa reuni\xF3n.`);
  const id = walkinId(reunionId, parts.searchName);
  if (await c.leer(`members/${id}`)) {
    throw new AccesoError(`${parts.fullName} ya se hab\xEDa agregado a esa reuni\xF3n (id: ${id}).`);
  }
  const parecidas = findSimilarMembers(personas, parts.fullName, 8);
  return borrador(
    c.uid,
    "agregar_participante",
    { reunionId, nombre: parts.fullName, id },
    [
      'AGREGAR como participante (queda "por revisar", NO entra a la lista oficial):',
      `  ${parts.fullName}`,
      `  y marcarla presente en ${describir(sesion)}`,
      ...parecidas.length ? [
        "",
        "\u26A0\uFE0F OJO: ya hay fichas con un nombre parecido. Si es alguna de ellas, no",
        'la agregues de nuevo: m\xE1rcala con "preparar_marcar_presente".',
        ...parecidas.map(
          ({ member: p, exact }) => `  \xB7 ${p.fullName}${exact ? " (MISMO nombre)" : ""}${p.pendingReview ? " (por revisar)" : ""}${p.active === false ? " (inactiva)" : ""}  id: ${p.id}`
        )
      ] : [],
      ...sesion.status === "closed" ? ["", "Esa reuni\xF3n est\xE1 CERRADA; se corrige igual por ser administraci\xF3n."] : []
    ].join("\n")
  );
}
async function prepararEstadoReunion(c, reunionRaw, cerrar) {
  const reunionId = idDe(reunionRaw, "la reuni\xF3n");
  const sesion = await reunion(c, reunionId);
  if (cerrar && sesion.status === "closed") throw new AccesoError("Esa reuni\xF3n ya est\xE1 cerrada.");
  if (!cerrar && sesion.status === "open") throw new AccesoError("Esa reuni\xF3n ya est\xE1 abierta.");
  return borrador(
    c.uid,
    cerrar ? "cerrar_reunion" : "reabrir_reunion",
    { reunionId },
    [
      cerrar ? "CERRAR la reuni\xF3n:" : "REABRIR la reuni\xF3n:",
      `  ${describir(sesion)}`,
      cerrar ? "  Al cerrarla, las coordinadoras ya no podr\xE1n modificarla." : "  Al reabrirla, las coordinadoras vuelven a poder marcar asistencia."
    ].join("\n")
  );
}
async function prepararAprobarPersona(c, personaRaw, nombreCorregido) {
  const personaId = idDe(personaRaw, "la persona");
  const ficha = await persona(c, personaId);
  if (!ficha.pendingReview) {
    throw new AccesoError(
      `${ficha.fullName} ya forma parte de la lista oficial.` + (ficha.pendingIdentify ? " Sigue sin nombre real: corr\xEDgelo en la app (Personas \u2192 Editar)." : "")
    );
  }
  const parts = buildNameParts((nombreCorregido ?? ficha.fullName).trim());
  if (parts.fullName.length < 3) throw new AccesoError("El nombre es demasiado corto.");
  if (parts.fullName.startsWith(UNKNOWN_PREFIX)) {
    throw new AccesoError(
      `"${parts.fullName}" no es un nombre real. Para aprobarla, p\xE1sale su nombre en "nombre".`
    );
  }
  const [registros, personas] = await Promise.all([
    c.asistenciasDePersona(personaId),
    c.cargarPersonas()
  ]);
  const parecidas = findSimilarMembers(
    personas.filter((p) => p.id !== personaId && !p.pendingReview),
    parts.fullName,
    6
  );
  const aCorregir = registros.filter((r) => r.datos.fullName !== parts.fullName).length;
  return borrador(
    c.uid,
    "aprobar_persona",
    { personaId, nombre: parts.fullName },
    [
      "APROBAR e incorporar a la lista oficial:",
      `  ${parts.fullName}` + (parts.fullName !== ficha.fullName ? `   (antes: "${ficha.fullName}")` : ""),
      ...ficha.createdByName ? [`  La registr\xF3: ${ficha.createdByName}`] : [],
      ...aCorregir ? [`  Se corrige el nombre en ${aCorregir} asistencia(s) ya registradas.`] : [],
      ...parecidas.length ? [
        "",
        "\u26A0\uFE0F OJO: en la lista oficial ya hay fichas parecidas. Si es la misma",
        'persona, NO la apruebes: \xFAnelas desde la app (Revisar \u2192 "Es la misma',
        'persona"), as\xED su asistencia queda en una sola ficha.',
        ...parecidas.map(({ member: p }) => `  \xB7 ${p.fullName}  id: ${p.id}`)
      ] : []
    ].join("\n")
  );
}
async function ejecutar(c, o) {
  switch (o.op) {
    case "crear_reunion": {
      const id = idDe(o.args.id, "la reuni\xF3n");
      const type = TIPOS[tipoDe(o.args.tipo)];
      const modalidad = modalidadDe(o.args.modalidad);
      const fecha = fechaDe(o.args.fecha);
      const coordinadora = String(o.args.coordinadora ?? "").trim();
      const d = sessionDateFromKey(fecha);
      try {
        await c.guardar([
          {
            tipo: "crear",
            ruta: `sessions/${id}`,
            datos: {
              type,
              modality: modalidad,
              date: d,
              status: "open",
              createdBy: c.uid,
              createdByName: c.nombre,
              createdAt: /* @__PURE__ */ new Date(),
              presentCount: 0,
              coordinator: coordinadora
            }
          }
        ]);
      } catch (e) {
        if (e instanceof ConflictoError && e.motivo === "ya_existe") {
          return `Esa reuni\xF3n ya estaba creada (id: ${id}); no se cre\xF3 otra. Si confirmaste dos veces, la primera ya hab\xEDa quedado guardada.`;
        }
        throw e;
      }
      return `Listo. Reuni\xF3n de ${SESSION_TYPE_LABELS[type]} creada para el ${fmtDate(d)} y abierta para tomar asistencia.
  id: ${id}` + (daysFromToday(d) < 0 ? '\n\nCuando termines de pasar la lista, ci\xE9rrala con "preparar_cerrar_reunion".' : "");
    }
    case "marcar_presente":
    case "quitar_presente": {
      const reunionId = idDe(o.args.reunionId, "la reuni\xF3n");
      const personaId = idDe(o.args.personaId, "la persona");
      const marcar = o.op === "marcar_presente";
      const [sesion, ficha] = await Promise.all([reunion(c, reunionId), persona(c, personaId)]);
      if (marcar) exigirQueYaOcurrio(sesion);
      const ruta = `sessions/${reunionId}/attendance/${personaId}`;
      const lote = marcar ? [{ tipo: "crear", ruta, datos: asistenciaNueva(c, sesion, personaId, ficha.fullName) }] : [{ tipo: "borrar", ruta }];
      lote.push({
        tipo: "sumar",
        ruta: `sessions/${reunionId}`,
        campo: "presentCount",
        cantidad: marcar ? 1 : -1
      });
      const yaHecho = async () => {
        const presentes2 = await presentesEn(c, reunionId);
        return marcar ? `${ficha.fullName} ya figuraba como presente: no se cont\xF3 dos veces. Hay ${presentes2} presentes.` : `${ficha.fullName} ya no figuraba en esa reuni\xF3n: no se rest\xF3 nada. Hay ${presentes2} presentes.`;
      };
      try {
        await c.guardar(lote);
      } catch (e) {
        const choque = e instanceof ConflictoError || e instanceof AccesoError && e.message === "PERMISSION_DENIED";
        if (choque) {
          const esta = await c.leer(ruta) !== null;
          if (esta === marcar) return yaHecho();
        }
        throw e;
      }
      const presentes = await presentesEn(c, reunionId);
      return [
        `Listo. ${ficha.fullName} ${marcar ? "qued\xF3 presente en" : "sali\xF3 de"} ${describir(sesion)}. Ahora hay ${presentes} presentes.`,
        ...avisoSiSigueAbierta(sesion)
      ].join("\n");
    }
    case "agregar_participante": {
      const reunionId = idDe(o.args.reunionId, "la reuni\xF3n");
      const id = idDe(o.args.id, "la ficha");
      const parts = buildNameParts(String(o.args.nombre ?? ""));
      const sesion = await reunion(c, reunionId);
      exigirQueYaOcurrio(sesion);
      const fechaReunion = toDate2(sesion.date);
      try {
        await c.guardar([
          {
            tipo: "crear",
            ruta: `members/${id}`,
            datos: {
              fullName: parts.fullName,
              firstName: parts.firstName,
              lastName: parts.lastName,
              searchName: parts.searchName,
              aliases: [],
              phone: "",
              notes: "",
              active: true,
              createdAt: /* @__PURE__ */ new Date(),
              createdBy: c.uid,
              createdByName: c.nombre,
              pendingIdentify: false,
              pendingReview: true,
              sourceSessionId: reunionId,
              sourceSessionDate: fechaReunion
            }
          },
          {
            tipo: "crear",
            ruta: `sessions/${reunionId}/attendance/${id}`,
            datos: asistenciaNueva(c, sesion, id, parts.fullName)
          },
          { tipo: "sumar", ruta: `sessions/${reunionId}`, campo: "presentCount", cantidad: 1 }
        ]);
      } catch (e) {
        if (e instanceof ConflictoError && e.motivo === "ya_existe") {
          return `${parts.fullName} ya se hab\xEDa agregado a esa reuni\xF3n (id: ${id}); no se cre\xF3 otra ficha. Si confirmaste dos veces, la primera ya hab\xEDa quedado guardada.`;
        }
        throw e;
      }
      const presentes = await presentesEn(c, reunionId);
      return [
        `Listo. ${parts.fullName} qued\xF3 presente en ${describir(sesion)} y espera revisi\xF3n (no est\xE1 en la lista oficial). Ahora hay ${presentes} presentes.
  id: ${id}`,
        ...avisoSiSigueAbierta(sesion)
      ].join("\n");
    }
    case "cerrar_reunion":
    case "reabrir_reunion": {
      const reunionId = idDe(o.args.reunionId, "la reuni\xF3n");
      const estado = o.op === "cerrar_reunion" ? "closed" : "open";
      try {
        await c.guardar([{ tipo: "actualizar", ruta: `sessions/${reunionId}`, datos: { status: estado } }]);
      } catch (e) {
        if ((e instanceof ConflictoError || e instanceof AccesoError && e.message === "PERMISSION_DENIED") && !await c.leer(`sessions/${reunionId}`)) {
          throw new AccesoError("Esa reuni\xF3n ya no existe (la borraron). No se cambi\xF3 nada.");
        }
        throw e;
      }
      return `Listo. La reuni\xF3n qued\xF3 ${estado === "closed" ? "cerrada" : "abierta"}.`;
    }
    case "aprobar_persona": {
      const personaId = idDe(o.args.personaId, "la persona");
      const parts = buildNameParts(String(o.args.nombre ?? ""));
      if (parts.fullName.length < 3 || parts.fullName.startsWith(UNKNOWN_PREFIX)) {
        throw new AccesoError("El nombre no es v\xE1lido. Prepara la aprobaci\xF3n de nuevo.");
      }
      const ficha = await c.leer(`members/${personaId}`);
      if (!ficha) {
        throw new AccesoError(
          "Esa ficha ya no existe (la unieron con otra o la descartaron). No se cambi\xF3 nada."
        );
      }
      if (!ficha.pendingReview) return `${ficha.fullName} ya estaba aprobada.`;
      const registros = (await c.asistenciasDePersona(personaId)).filter(
        (r) => r.datos.fullName !== parts.fullName
      );
      const correcciones = registros.map((r) => ({
        tipo: "actualizar",
        ruta: r.ruta,
        datos: { fullName: parts.fullName }
      }));
      const aprobacion = {
        tipo: "actualizar",
        ruta: `members/${personaId}`,
        datos: {
          fullName: parts.fullName,
          firstName: parts.firstName,
          lastName: parts.lastName,
          searchName: parts.searchName,
          pendingReview: false,
          pendingIdentify: false
        }
      };
      try {
        if (correcciones.length < 500) {
          await c.guardar([...correcciones, aprobacion]);
        } else {
          for (let i = 0; i < correcciones.length; i += 450) {
            await c.guardar(correcciones.slice(i, i + 450));
          }
          await c.guardar([aprobacion]);
        }
      } catch (e) {
        if (e instanceof ConflictoError || e instanceof AccesoError && e.message === "PERMISSION_DENIED") {
          throw new AccesoError(
            "La ficha o alguna de sus asistencias cambi\xF3 mientras tanto. No se guard\xF3 nada: prepara la aprobaci\xF3n de nuevo."
          );
        }
        throw e;
      }
      return `Listo. ${parts.fullName} ya forma parte de la lista oficial.` + (registros.length ? ` Se corrigi\xF3 el nombre en ${registros.length} asistencia(s).` : "");
    }
    default:
      throw new AccesoError(`Operaci\xF3n desconocida: ${o.op}`);
  }
}

// mcp/src/herramientas.ts
var objeto = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required
});
var txt = (description) => ({ type: "string", description });
var HERRAMIENTAS = [
  {
    name: "quien_soy",
    title: "Con qu\xE9 cuenta estoy consultando",
    description: "Dice con qu\xE9 cuenta y con qu\xE9 rol est\xE1 conectado Claude, y por tanto qu\xE9 puede y qu\xE9 no puede consultar. \xDAtil para comprobar que la llave es la correcta.",
    alcance: "todos",
    inputSchema: objeto(),
    async ejecutar(c) {
      const permitidas = HERRAMIENTAS.filter((h) => permitida(h, c));
      const escritura = permitidas.filter((h) => h.alcance === "escribir");
      return [
        `Cuenta: ${c.nombre} (${c.email})`,
        `Rol: ${ROL_LEGIBLE[c.rol] ?? c.rol}`,
        "",
        c.esAdmin ? "PERMISOS: LECTURA Y ESCRITURA. Puedes consultar todo y adem\xE1s registrar y corregir cosas (siempre con una confirmaci\xF3n de por medio)." : "PERMISOS: SOLO LECTURA. Puedes consultar, pero NO se puede cambiar nada desde aqu\xED: ni marcar asistencia, ni crear reuniones, ni tocar fichas. Eso es de administraci\xF3n.",
        "",
        `Herramientas disponibles para ti: ${permitidas.length} de ${HERRAMIENTAS.length}`,
        ...permitidas.filter((h) => h.alcance !== "escribir").map((h) => `  \xB7 ${h.name} (consulta)`),
        ...escritura.map((h) => `  \xB7 ${h.name} (MODIFICA datos)`),
        ...c.esAdmin ? [] : [
          "",
          "Tampoco ves el historial de una persona concreta ni la bandeja de revisi\xF3n: eso tambi\xE9n es de administraci\xF3n."
        ]
      ].join("\n");
    }
  },
  {
    name: "como_vamos",
    title: "\xBFC\xF3mo vamos?",
    description: 'Responde cu\xE1ntas personas est\xE1n viniendo \xDALTIMAMENTE a un tipo de reuni\xF3n (no en todo el a\xF1o): la cifra, si subi\xF3 o baj\xF3 frente al per\xEDodo anterior, el promedio de presentes por reuni\xF3n y el reparto en grupos (firmes, nuevas, van y vienen, se est\xE1n alejando) con los nombres. Es el mismo c\xE1lculo que muestra el apartado "\xBFC\xF3mo vamos?" del Panel de la app.',
    alcance: "todos",
    inputSchema: objeto({
      tipo: {
        type: "string",
        enum: ["pasos", "ego"],
        default: "pasos",
        description: "pasos = Entrega de Pasos; ego = Sala de Reducci\xF3n del Ego"
      },
      ventana: {
        type: "integer",
        minimum: 1,
        maximum: 52,
        default: 4,
        description: "Cu\xE1ntas reuniones hacia atr\xE1s mirar. La app usa 4, 8 o 12."
      },
      con_nombres: { type: "boolean", default: true, description: "Incluir los nombres." }
    }),
    async ejecutar(c, a) {
      const [sessions, attendance] = await Promise.all([
        c.cargarSesiones(),
        c.cargarAsistencia()
      ]);
      return informeComoVamos(
        sessions,
        attendance,
        a.tipo ?? "pasos",
        Number(a.ventana ?? 4),
        a.con_nombres !== false
      );
    }
  },
  {
    name: "reuniones",
    title: "Listar reuniones",
    description: 'Las reuniones m\xE1s recientes que ya ocurrieron (y aparte las agendadas), con fecha, tipo, modalidad, qui\xE9n coordin\xF3, cu\xE1ntas personas asistieron y si la sesi\xF3n sigue abierta. Devuelve el id de cada una para consultar su lista. Para pasar la lista de una reuni\xF3n, toma el id de "Recientes", no de "Agendadas".',
    alcance: "todos",
    inputSchema: objeto({
      tipo: { type: "string", enum: ["pasos", "ego", "todas"], default: "todas" },
      limite: { type: "integer", minimum: 1, maximum: 100, default: 10 }
    }),
    async ejecutar(c, a) {
      const [sessions, attendance] = await Promise.all([
        c.cargarSesiones(),
        c.cargarAsistencia()
      ]);
      return informeReuniones(
        sessions,
        attendance,
        a.tipo ?? "todas",
        Number(a.limite ?? 10)
      );
    }
  },
  {
    name: "asistencia_reunion",
    title: "Qui\xE9nes fueron a una reuni\xF3n",
    description: 'La lista de personas presentes en una reuni\xF3n concreta. El id se obtiene con la herramienta "reuniones".',
    alcance: "todos",
    inputSchema: objeto({ reunion_id: txt("id de la reuni\xF3n") }, ["reunion_id"]),
    async ejecutar(c, a) {
      const id = String(a.reunion_id ?? "").trim();
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return `El id de reuni\xF3n "${id}" no es v\xE1lido.`;
      const [sesion, asistentes] = await Promise.all([
        c.leer(`sessions/${id}`),
        c.asistenciaDe(id)
      ]);
      return informeAsistenciaReunion(sesion, asistentes, id);
    }
  },
  {
    name: "conteos",
    title: "Conteos generales",
    description: "Totales r\xE1pidos: personas en la lista oficial (activas y totales), reuniones registradas por tipo, y cu\xE1ntas personas nuevas esperan revisi\xF3n.",
    alcance: "admin",
    inputSchema: objeto(),
    async ejecutar(c) {
      const [sessions, personas] = await Promise.all([c.cargarSesiones(), c.cargarPersonas()]);
      return informeConteos(sessions, personas);
    }
  },
  {
    name: "buscar_persona",
    title: "Buscar una persona",
    description: "Busca personas por nombre o alias, igual que el buscador de la app (tolera acentos, may\xFAsculas, orden de las palabras y errores de tipeo). Devuelve su id para consultar el historial o marcarla presente. No devuelve tel\xE9fonos ni notas. Si no aparece con el nombre completo, prueba con solo el primer nombre antes de agregarla como nueva.",
    alcance: "admin",
    inputSchema: objeto({ nombre: txt("Nombre o parte del nombre") }, ["nombre"]),
    async ejecutar(c, a) {
      return informeBuscarPersona(await c.cargarPersonas(), String(a.nombre));
    }
  },
  {
    name: "historial_persona",
    title: "Historial de una persona",
    description: 'Todas las veces que una persona ha asistido, separadas por tipo de reuni\xF3n, con su porcentaje de asistencia desde que lleg\xF3. El id se obtiene con "buscar_persona".',
    alcance: "admin",
    inputSchema: objeto({ persona_id: txt("id de la persona") }, ["persona_id"]),
    async ejecutar(c, a) {
      const id = String(a.persona_id ?? "").trim();
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return `El id de persona "${id}" no es v\xE1lido.`;
      const [sessions, registros, personas] = await Promise.all([
        c.cargarSesiones(),
        c.asistenciasDePersona(id),
        c.cargarPersonas()
      ]);
      return informeHistorial(
        sessions,
        registros.map((r) => r.datos),
        personas,
        id
      );
    }
  },
  {
    name: "por_revisar",
    title: "Personas esperando revisi\xF3n",
    description: "Las personas que una coordinadora agreg\xF3 en plena reuni\xF3n y que todav\xEDa no forman parte de la lista oficial, para que la administraci\xF3n las apruebe, las una con alguien que ya exist\xEDa o las descarte.",
    alcance: "admin",
    inputSchema: objeto(),
    async ejecutar(c) {
      return informePorRevisar(await c.cargarPersonas());
    }
  },
  /* --------------------------------------------------------------- */
  /* ESCRITURA — solo administración, y siempre en dos pasos           */
  /* --------------------------------------------------------------- */
  {
    name: "preparar_crear_reunion",
    title: "Preparar: crear una reuni\xF3n",
    description: 'Prepara la creaci\xF3n de una reuni\xF3n (no la crea todav\xEDa: devuelve un borrador para revisar). Si ya existe una de ese tipo ese d\xEDa, lo dice y da su id: usa esa. Mu\xE9strale el borrador a la persona y solo llama a "confirmar_operacion" cuando lo apruebe expl\xEDcitamente.',
    alcance: "escribir",
    inputSchema: objeto(
      {
        tipo: { type: "string", enum: ["pasos", "ego"] },
        modalidad: { type: "string", enum: ["presencial", "virtual"] },
        fecha: txt("Fecha en formato AAAA-MM-DD (d\xEDa en Colombia)"),
        coordinadora: txt("Qui\xE9n coordina (opcional)"),
        otra_mas: {
          type: "boolean",
          default: false,
          description: "true SOLO si de verdad hay dos reuniones del mismo tipo el mismo d\xEDa."
        }
      },
      ["tipo", "modalidad", "fecha"]
    ),
    ejecutar: (c, a) => prepararCrearReunion(
      c,
      a.tipo,
      a.modalidad,
      a.fecha,
      a.coordinadora ? String(a.coordinadora) : void 0,
      a.otra_mas === true
    )
  },
  {
    name: "preparar_marcar_presente",
    title: "Preparar: marcar a alguien presente",
    description: "Prepara marcar a una persona como presente en una reuni\xF3n. Devuelve un borrador; no cambia nada hasta confirmar.",
    alcance: "escribir",
    inputSchema: objeto(
      { reunion_id: txt("id de la reuni\xF3n"), persona_id: txt("id de la persona") },
      ["reunion_id", "persona_id"]
    ),
    ejecutar: (c, a) => prepararMarcar(c, a.reunion_id, a.persona_id, false)
  },
  {
    name: "preparar_agregar_participante",
    title: "Preparar: agregar a alguien que no est\xE1 en la lista",
    description: 'Para alguien que asisti\xF3 pero no tiene ficha (buscar_persona no lo encuentra). Igual que cuando una coordinadora lo agrega en plena reuni\xF3n: queda presente en esa reuni\xF3n y en la bandeja "por revisar", SIN entrar a la lista oficial. Si ya existe una ficha parecida, el borrador la muestra: en ese caso usa preparar_marcar_presente con esa ficha en vez de crear otra. Devuelve un borrador; no cambia nada hasta confirmar.',
    alcance: "escribir",
    inputSchema: objeto(
      {
        reunion_id: txt("id de la reuni\xF3n"),
        nombre: txt("Nombre completo de la persona, tal como se quiere registrar")
      },
      ["reunion_id", "nombre"]
    ),
    ejecutar: (c, a) => prepararAgregarParticipante(c, a.reunion_id, a.nombre)
  },
  {
    name: "preparar_quitar_presente",
    title: "Preparar: quitar a alguien de la lista",
    description: "Prepara quitar a una persona de la asistencia de una reuni\xF3n. Devuelve un borrador; no cambia nada hasta confirmar.",
    alcance: "escribir",
    inputSchema: objeto(
      { reunion_id: txt("id de la reuni\xF3n"), persona_id: txt("id de la persona") },
      ["reunion_id", "persona_id"]
    ),
    ejecutar: (c, a) => prepararMarcar(c, a.reunion_id, a.persona_id, true)
  },
  {
    name: "preparar_cerrar_reunion",
    title: "Preparar: cerrar o reabrir una reuni\xF3n",
    description: "Prepara cerrar una reuni\xF3n (o reabrirla, con abrir=true). Al cerrarla, las coordinadoras dejan de poder modificarla. Devuelve un borrador.",
    alcance: "escribir",
    inputSchema: objeto(
      {
        reunion_id: txt("id de la reuni\xF3n"),
        abrir: { type: "boolean", default: false, description: "true = reabrir en vez de cerrar" }
      },
      ["reunion_id"]
    ),
    ejecutar: (c, a) => prepararEstadoReunion(c, a.reunion_id, a.abrir !== true)
  },
  {
    name: "preparar_aprobar_persona",
    title: "Preparar: aprobar a una persona nueva",
    description: "Prepara aprobar a una persona que est\xE1 esperando revisi\xF3n, opcionalmente corrigiendo su nombre (se corrige tambi\xE9n en sus asistencias, como en la app). Si ya hay una ficha parecida en la lista oficial, el borrador lo avisa: en ese caso hay que unirlas desde la app, no aprobar. Devuelve un borrador.",
    alcance: "escribir",
    inputSchema: objeto(
      { persona_id: txt("id de la persona"), nombre: txt("Nombre completo corregido (opcional)") },
      ["persona_id"]
    ),
    ejecutar: (c, a) => prepararAprobarPersona(c, a.persona_id, a.nombre ? String(a.nombre) : void 0)
  },
  {
    name: "confirmar_operacion",
    title: "Confirmar y ejecutar",
    description: "EJECUTA de verdad una operaci\xF3n preparada antes. \xDAsalo SOLO despu\xE9s de haberle mostrado el borrador a la persona y de que lo haya aprobado de forma expl\xEDcita en ese mismo momento. Si duda o corrige algo, prepara uno nuevo en vez de confirmar el anterior. Copia el confirmacion_id completo, tal cual. Confirmar dos veces el mismo borrador no repite nada.",
    alcance: "escribir",
    inputSchema: objeto(
      { confirmacion_id: txt("El identificador que devolvi\xF3 el borrador") },
      ["confirmacion_id"]
    ),
    ejecutar: (c, a) => ejecutar(c, desempaquetar(String(a.confirmacion_id), c.uid))
  },
  {
    name: "refrescar",
    title: "Releer los datos",
    description: "Vac\xEDa la cach\xE9 de un minuto y vuelve a leer todo. \xDAtil si acaban de tomar asistencia y quieres los datos al segundo.",
    alcance: "todos",
    inputSchema: objeto(),
    async ejecutar(c) {
      olvidar(c.uid);
      const [sessions, attendance] = await Promise.all([
        c.cargarSesiones(),
        c.cargarAsistencia()
      ]);
      return `Datos rele\xEDdos: ${sessions.length} reuniones y ${attendance.length} asistencias.`;
    }
  }
];
var ROL_LEGIBLE = {
  super_admin: "Super administrador(a) \u2014 lectura y escritura",
  admin: "Administrador(a) \u2014 lectura y escritura",
  coordinador: "Coordinador(a) \u2014 SOLO LECTURA"
};
function catalogoPara(c) {
  return HERRAMIENTAS.filter((h) => h.alcance === "todos" || c.esAdmin).map(
    ({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema })
  );
}
function buscarHerramienta(nombre) {
  return HERRAMIENTAS.find((h) => h.name === nombre);
}
function permitida(h, c) {
  return h.alcance === "todos" || c.esAdmin;
}

// mcp/src/sobre.ts
import { createCipheriv, createDecipheriv, createHash as createHash2, randomBytes } from "node:crypto";
var PREFIJO = "g1.";
var SinSecretoError = class extends Error {
};
function clave() {
  const s = process.env.MCP_SECRETO ?? "";
  if (s.length < 32) {
    throw new SinSecretoError(
      "Falta configurar MCP_SECRETO en el servidor (Vercel \u2192 Settings \u2192 Environment Variables). Sin ella no se puede conectar Claude."
    );
  }
  return createHash2("sha256").update(s).digest();
}
var esSobre = (s) => s.startsWith(PREFIJO);
function abrir(tipo, sobre) {
  if (!esSobre(sobre)) return null;
  const k = clave();
  try {
    const b = Buffer.from(sobre.slice(PREFIJO.length), "base64url");
    if (b.length < 12 + 16 + 2) return null;
    const d = createDecipheriv("aes-256-gcm", k, b.subarray(0, 12));
    d.setAAD(Buffer.from(tipo));
    d.setAuthTag(b.subarray(b.length - 16));
    const json = Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]);
    return JSON.parse(json.toString("utf8"));
  } catch {
    return null;
  }
}

// mcp/src/http.ts
process.env.TZ = "America/Bogota";
var VERSIONES = ["2025-06-18", "2025-03-26", "2024-11-05"];
var VERSION_PROTOCOLO = VERSIONES[0];
function versionAcordada(params) {
  const pedida = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
  return VERSIONES.includes(pedida) ? pedida : VERSION_PROTOCOLO;
}
var ok = (id, result) => ({ jsonrpc: "2.0", id, result });
var fallo = (id, code, message2) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message: message2 }
});
var respuestaTexto = (id, texto, esError = false) => ok(id, { content: [{ type: "text", text: texto }], ...esError ? { isError: true } : {} });
function saludo(p) {
  switch (p.method) {
    case "initialize":
      return ok(p.id, {
        protocolVersion: versionAcordada(p.params),
        capabilities: { tools: {} },
        serverInfo: { name: "coordinacion-gemb", version: "3.0.0" }
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok(p.id, {});
    default:
      return void 0;
  }
}
async function atender(p, obtener) {
  const previo = saludo(p);
  if (previo !== void 0) return previo;
  let cliente;
  try {
    cliente = await obtener();
  } catch (e) {
    const mensaje = e instanceof ConfigError || e instanceof AccesoError ? e.message : `No se pudo validar la llave: ${e instanceof Error ? e.message : String(e)}`;
    if (p.method === "tools/list") {
      return ok(p.id, {
        tools: [
          {
            name: "quien_soy",
            title: "Revisar la conexi\xF3n",
            description: "Dice con qu\xE9 cuenta est\xE1 conectado Claude y qu\xE9 puede hacer. Ahora mismo la conexi\xF3n no est\xE1 completa; ll\xE1mala para saber por qu\xE9.",
            inputSchema: { type: "object", properties: {}, required: [] }
          }
        ]
      });
    }
    return respuestaTexto(p.id, mensaje, true);
  }
  switch (p.method) {
    case "tools/list":
      return ok(p.id, { tools: catalogoPara(cliente) });
    case "tools/call": {
      const nombre = String(p.params?.name ?? "");
      const herramienta = buscarHerramienta(nombre);
      if (!herramienta) return fallo(p.id, -32602, `No existe la herramienta "${nombre}".`);
      if (!permitida(herramienta, cliente)) {
        return respuestaTexto(
          p.id,
          `"${nombre}" es solo para administraci\xF3n, y tu cuenta (${cliente.email}) entra como coordinador(a). Puedes consultar las reuniones y c\xF3mo va el grupo; el detalle de una persona concreta y la bandeja de revisi\xF3n, no.`,
          true
        );
      }
      try {
        const texto = await herramienta.ejecutar(
          cliente,
          p.params?.arguments ?? {}
        );
        return respuestaTexto(p.id, texto);
      } catch (e) {
        if (e instanceof AccesoError && e.message === "PERMISSION_DENIED") {
          return respuestaTexto(
            p.id,
            "Las reglas de la app no dejan a tu cuenta leer eso. Si crees que deber\xEDa, pide que revisen tu rol en Usuarios.",
            true
          );
        }
        const mensaje = e instanceof ConfigError || e instanceof AccesoError ? e.message : `No se pudo consultar: ${e instanceof Error ? e.message : String(e)}`;
        return respuestaTexto(p.id, mensaje, true);
      }
    }
    default:
      return fallo(p.id, -32601, `M\xE9todo no soportado: ${p.method}`);
  }
}
function llaveDe(req) {
  const cabecera = req.headers.authorization;
  return (Array.isArray(cabecera) ? cabecera[0] : cabecera ?? "").replace(/^Bearer\s+/i, "").trim();
}
function llaveEnUrl(req) {
  try {
    const u = new URL(req.url ?? "", "http://x");
    return u.searchParams.has("k") || u.searchParams.has("llave");
  } catch {
    return false;
  }
}
var DONDE_ENTRAR = 'Bearer realm="coordinacion-gemb", resource_metadata="https://coordinacion-gemb.vercel.app/.well-known/oauth-protected-resource"';
async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method === "GET") {
    const acepta = req.headers.accept;
    const quiereFlujo = (Array.isArray(acepta) ? acepta.join(",") : acepta ?? "").includes(
      "text/event-stream"
    );
    if (quiereFlujo) {
      res.setHeader("Allow", "POST, OPTIONS");
      res.status(405).json(fallo(null, -32600, "Este servidor solo atiende por POST."));
      return;
    }
  }
  if (req.method === "GET") {
    res.status(200).json({
      nombre: "coordinacion-gemb",
      mcp: VERSION_PROTOCOLO,
      estado: "en pie",
      como_conectar: 'Agrega esta direcci\xF3n como conector en Claude con autenticaci\xF3n "siempre requerida" y entra con Google cuando te lo pida. Los pasos, en la app: Ajustes (rueda dentada) \u2192 "Conectar con Claude".'
    });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json(fallo(null, -32600, "Usa POST."));
    return;
  }
  if (llaveEnUrl(req)) {
    res.status(400).json(
      fallo(
        null,
        -32600,
        'La llave ya no se acepta en la direcci\xF3n (?k=\u2026): quedaba guardada en los registros. Quita ese pedazo de la direcci\xF3n del conector y entra con Google desde Claude ("Conectar").'
      )
    );
    return;
  }
  const bearer = llaveDe(req);
  let llave = "";
  if (bearer) {
    let acceso;
    try {
      acceso = abrir("acceso", bearer);
    } catch (e) {
      if (e instanceof SinSecretoError) {
        res.status(500).json(fallo(null, -32603, e.message));
        return;
      }
      throw e;
    }
    if (!acceso || typeof acceso.llave !== "string") {
      res.setHeader("WWW-Authenticate", `${DONDE_ENTRAR}, error="invalid_token"`);
      res.status(401).json(
        fallo(
          null,
          -32001,
          "Esta conexi\xF3n ya no vale (se renov\xF3 la seguridad). Vuelve a conectar el conector desde Claude y entra con Google."
        )
      );
      return;
    }
    llave = acceso.llave;
  }
  const cuerpo = req.body;
  const peticiones = Array.isArray(cuerpo) ? cuerpo : [cuerpo ?? {}];
  const soloSaludo = peticiones.every((p) => saludo(p) !== void 0);
  if (!llave && !soloSaludo) {
    res.setHeader("WWW-Authenticate", DONDE_ENTRAR);
    res.status(401).json(
      fallo(null, -32001, "Hay que entrar con Google. Conecta el conector desde Claude.")
    );
    return;
  }
  let abierta = null;
  const obtener = () => abierta ??= abrirSesion(llave);
  if (!soloSaludo) {
    try {
      await obtener();
    } catch (e) {
      if (e instanceof LlaveInvalidaError) {
        res.setHeader("WWW-Authenticate", `${DONDE_ENTRAR}, error="invalid_token"`);
        res.status(401).json(fallo(null, -32001, e.message));
        return;
      }
    }
  }
  const respuestas = [];
  for (const p of peticiones) {
    const r = await atender(p, obtener);
    if (r !== null) respuestas.push(r);
  }
  if (respuestas.length === 0) {
    res.status(202).end();
    return;
  }
  res.status(200).json(Array.isArray(cuerpo) ? respuestas : respuestas[0]);
}
export {
  handler as default
};
