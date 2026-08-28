// mcp/src/rest.ts
var PROJECT_ID = "coordinacion-gemb";
var API_KEY = "AIzaSyB-KQMYvpKun5oxQhqTSyF-ElhJxAp-eGQ";
var DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
var ConfigError = class extends Error {
};
var AccesoError = class extends Error {
};
var sesion = null;
async function entrar() {
  if (sesion && sesion.expira > Date.now() + 6e4) return sesion;
  const email = process.env.GEMB_EMAIL?.trim();
  const password = process.env.GEMB_PASSWORD;
  if (!email || !password) {
    throw new ConfigError(
      "Faltan GEMB_EMAIL y GEMB_PASSWORD: son los datos de la cuenta de solo lectura que la app usa para consultar. Ver mcp/README.md."
    );
  }
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );
  const data = await r.json();
  if (!r.ok || !data.idToken) {
    const codigo = data.error?.message ?? `HTTP ${r.status}`;
    throw new ConfigError(mensajeDeEntrada(codigo, email));
  }
  sesion = {
    idToken: data.idToken,
    uid: data.localId ?? "",
    email,
    expira: Date.now() + Number(data.expiresIn ?? 3600) * 1e3
  };
  return sesion;
}
function mensajeDeEntrada(codigo, email) {
  if (codigo.startsWith("PASSWORD_LOGIN_DISABLED")) {
    return "Falta activar el ingreso por correo y contrase\xF1a en Firebase: consola de Firebase \u2192 Authentication \u2192 Sign-in method \u2192 Email/Password \u2192 Habilitar. (Es un interruptor; no tiene nada que ver con las claves de cuenta de servicio que tu organizaci\xF3n bloquea.)";
  }
  if (codigo.startsWith("EMAIL_NOT_FOUND") || codigo.startsWith("INVALID_LOGIN_CREDENTIALS") || codigo.startsWith("INVALID_PASSWORD")) {
    return `No se pudo entrar como ${email}. Comprueba que la cuenta existe (Firebase \u2192 Authentication \u2192 Users \u2192 Add user) y que la contrase\xF1a guardada coincide.`;
  }
  if (codigo.startsWith("USER_DISABLED")) {
    return `La cuenta ${email} est\xE1 deshabilitada en Firebase.`;
  }
  if (codigo.startsWith("TOO_MANY_ATTEMPTS")) {
    return "Firebase bloque\xF3 temporalmente los intentos. Espera unos minutos.";
  }
  return `No se pudo entrar como ${email}: ${codigo}`;
}
async function registrarse(s) {
  const invite = await pedir(
    `${DOCS}/invites/${encodeURIComponent(s.email.toLowerCase())}`,
    s,
    true
  );
  const rol = invite && typeof invite === "object" ? invite.fields?.role?.stringValue ?? "" : "";
  if (!rol) {
    throw new AccesoError(
      `La cuenta ${s.email} todav\xEDa no tiene permiso dentro de la app. Entra a la app como administradora \u2192 Usuarios \u2192 "Pre-autorizar por correo" \u2192 ${s.email} con rol Coordinador(a). Despu\xE9s vuelve a intentar.`
    );
  }
  const r = await fetch(`${DOCS}/users/${s.uid}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${s.idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fields: {
        email: { stringValue: s.email },
        displayName: { stringValue: "Consultas (Claude)" },
        photoURL: { stringValue: "" },
        role: { stringValue: rol },
        active: { booleanValue: true },
        createdAt: { timestampValue: (/* @__PURE__ */ new Date()).toISOString() }
      }
    })
  });
  if (!r.ok) {
    throw new AccesoError(
      `No se pudo registrar la cuenta ${s.email} dentro de la app (HTTP ${r.status}). Comprueba que la pre-autorizaci\xF3n existe y que el rol es "admin" o "coordinador".`
    );
  }
}
async function pedir(url, s, toleraFalta = false) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${s.idToken}` } });
  if (r.status === 404 && toleraFalta) return null;
  if (r.status === 403) {
    throw new AccesoError("PERMISSION_DENIED");
  }
  if (!r.ok) {
    throw new AccesoError(`Firestore respondi\xF3 HTTP ${r.status} en ${url}`);
  }
  return r.json();
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
    const a = o.arrayValue.values ?? [];
    return a.map(valor);
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
async function coleccion(nombre, s) {
  const salida = [];
  let token = "";
  do {
    const url = `${DOCS}/${nombre}?pageSize=300${token ? `&pageToken=${token}` : ""}`;
    const r = await pedir(url, s);
    for (const d of r.documents ?? []) salida.push(aObjeto(d));
    token = r.nextPageToken ?? "";
  } while (token);
  return salida;
}
async function todaLaAsistencia(s) {
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
      structuredQuery.startAt = {
        values: [{ referenceValue: ultimo }],
        before: false
      };
    }
    const r = await fetch(`${DOCS}:runQuery`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.idToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ structuredQuery })
    });
    if (r.status === 403) throw new AccesoError("PERMISSION_DENIED");
    if (!r.ok) throw new AccesoError(`Firestore respondi\xF3 HTTP ${r.status} al leer la asistencia`);
    const filas = await r.json();
    const docs = filas.map((f) => f.document).filter((d) => !!d);
    for (const d of docs) salida.push(aObjeto(d));
    if (docs.length < TANDA) break;
    ultimo = docs[docs.length - 1].name;
  }
  return salida;
}
var TTL_MS = 6e4;
var cache = /* @__PURE__ */ new Map();
async function cacheado(clave, cargar) {
  const hit = cache.get(clave);
  if (hit && hit.hasta > Date.now()) return hit.valor;
  const valor2 = await cargar();
  cache.set(clave, { valor: valor2, hasta: Date.now() + TTL_MS });
  return valor2;
}
function limpiarCache() {
  cache.clear();
  sesion = null;
  registrado = false;
}
var registrado = false;
async function listo() {
  const s = await entrar();
  if (registrado) return s;
  const yo = await pedir(`${DOCS}/users/${s.uid}`, s, true).catch((e) => {
    if (e instanceof AccesoError && e.message === "PERMISSION_DENIED") return null;
    throw e;
  });
  if (!yo) await registrarse(s);
  registrado = true;
  return s;
}
async function cargarSesiones() {
  return cacheado("sessions", async () => coleccion("sessions", await listo()));
}
async function cargarAsistencia() {
  return cacheado("attendance", async () => todaLaAsistencia(await listo()));
}
async function cargarPersonas() {
  return cacheado("members", async () => {
    const todas = await coleccion("members", await listo());
    return todas.map(({ phone: _p, notes: _n, ...resto }) => resto);
  });
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
    const format2 = args.formats[width] || args.formats[args.defaultWidth];
    return format2;
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
function warnOrThrowProtectedError(token, format2, input) {
  const _message = message(token, format2, input);
  console.warn(_message);
  if (throwTokens.includes(token)) throw new RangeError(_message);
}
function message(token, format2, input) {
  const subject = token[0] === "Y" ? "years" : "days of the month";
  return `Use \`${token.toLowerCase()}\` instead of \`${token}\` (in \`${format2}\`) for formatting ${subject} to the input \`${input}\`; see: https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md`;
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
var fmtDate = (v) => format(toDate2(v), "d MMM yyyy", { locale: es });

// src/lib/constants.ts
var SESSION_TYPE_LABELS = {
  entrega_pasos: "Entrega de Pasos",
  reduccion_ego: "Sala de Reducci\xF3n del Ego"
};
var MODALITY_LABELS = {
  virtual: "Virtual",
  presencial: "Presencial"
};

// src/lib/activity.ts
var GROUP_ORDER = [
  "firmes",
  "nuevas",
  "irregulares",
  "alejandose",
  "dormidas"
];
function buildActivityReport(sessions, attendance, type, ventana, hoy = /* @__PURE__ */ new Date()) {
  const finDeHoy = new Date(
    hoy.getFullYear(),
    hoy.getMonth(),
    hoy.getDate(),
    23,
    59,
    59,
    999
  ).getTime();
  const realizadas2 = sessions.filter((s) => s.type === type && toDate2(s.date).getTime() <= finDeHoy).sort((a, b) => toDate2(b.date).getTime() - toDate2(a.date).getTime());
  const recientesS = realizadas2.slice(0, ventana);
  const previasS = realizadas2.slice(ventana, ventana * 2);
  const idsRecientes = new Set(recientesS.map((s) => s.id));
  const idsPrevias = new Set(previasS.map((s) => s.id));
  const mapa = /* @__PURE__ */ new Map();
  const presentesPorSesion = /* @__PURE__ */ new Map();
  for (const a of attendance) {
    if (a.sessionType !== type) continue;
    const fecha = toDate2(a.sessionDate);
    let p = mapa.get(a.memberId);
    if (!p) {
      p = {
        memberId: a.memberId,
        fullName: a.fullName,
        recientes: 0,
        previas: 0,
        primera: fecha,
        ultima: fecha,
        grupo: "dormidas"
      };
      mapa.set(a.memberId, p);
    }
    if (fecha.getTime() >= p.ultima.getTime()) {
      p.ultima = fecha;
      p.fullName = a.fullName;
    }
    if (fecha.getTime() < p.primera.getTime()) p.primera = fecha;
    if (idsRecientes.has(a.sessionId)) {
      p.recientes++;
      presentesPorSesion.set(
        a.sessionId,
        (presentesPorSesion.get(a.sessionId) ?? 0) + 1
      );
    } else if (idsPrevias.has(a.sessionId)) {
      p.previas++;
    }
  }
  const umbralFirmes = Math.max(1, Math.ceil(recientesS.length * 0.6));
  const inicioVentana = recientesS.length ? toDate2(recientesS[recientesS.length - 1].date).getTime() : null;
  const inicioMitad = recientesS.length ? toDate2(
    recientesS[Math.ceil(recientesS.length / 2) - 1].date
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
  const personas = [...mapa.values()].sort(
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
    recientes: [...recientesS].reverse().map((session) => ({
      session,
      presentes: presentesPorSesion.get(session.id) ?? 0
    })),
    previasCount: previasS.length,
    desde: recientesS.length ? toDate2(recientesS[recientesS.length - 1].date) : null,
    hasta: recientesS.length ? toDate2(recientesS[0].date) : null,
    activas,
    activasPrevias,
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
    `PERSONAS DISTINTAS QUE VINIERON: ${r.activas}${cmp(r.activas, r.activasPrevias)}`,
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

// src/lib/normalize.ts
var DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
function normalizeText(input) {
  return (input || "").normalize("NFD").replace(DIACRITICS, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// mcp/src/informes.ts
var TIPOS = {
  pasos: "entrega_pasos",
  ego: "reduccion_ego"
};
function realizadas(sessions, hoy) {
  const t = hoy.getTime();
  return sessions.filter((s) => toDate2(s.date).getTime() <= t);
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
  return [
    `Personas en la lista: ${personas.filter((p) => p.active !== false).length} activas de ${personas.length}`,
    `Esperando revisi\xF3n (walk-ins): ${personas.filter((p) => p.pendingReview).length}`,
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
  const lista = sessions.filter((s) => tipo === "todas" || s.type === TIPOS[tipo]).sort((a, b) => toDate2(b.date).getTime() - toDate2(a.date).getTime()).slice(0, limite);
  if (lista.length === 0) return "No hay reuniones registradas.";
  return lista.map((s) => {
    const aunNoOcurre = toDate2(s.date).getTime() > hoy.getTime();
    return `${fmtDate(s.date)} \xB7 ${SESSION_TYPE_LABELS[s.type]} \xB7 ${MODALITY_LABELS[s.modality]} \xB7 ` + (aunNoOcurre ? "AGENDADA (todav\xEDa no ocurre)" : `${presentes.get(s.id) ?? 0} presentes`) + (s.coordinator ? ` \xB7 coordin\xF3 ${s.coordinator}` : "") + (s.status === "open" ? " \xB7 ABIERTA" : "") + `
  id: ${s.id}`;
  }).join("\n");
}
function informeAsistenciaReunion(sessions, attendance, reunionId) {
  const s = sessions.find((x) => x.id === reunionId);
  if (!s) return `No existe ninguna reuni\xF3n con id ${reunionId}.`;
  const gente = attendance.filter((a) => a.sessionId === reunionId).sort((a, b) => a.fullName.localeCompare(b.fullName, "es"));
  return [
    `${SESSION_TYPE_LABELS[s.type]} \u2014 ${fmtDate(s.date)} \xB7 ${MODALITY_LABELS[s.modality]}` + (s.coordinator ? ` \xB7 coordin\xF3 ${s.coordinator}` : ""),
    `${gente.length} presentes:`,
    ...gente.map((a) => `  - ${a.fullName}`)
  ].join("\n");
}
function informeBuscarPersona(personas, nombre) {
  const palabras = normalizeText(nombre).split(/\s+/).filter(Boolean);
  const encontradas = personas.filter((p) => {
    const objetivo = p.searchName || normalizeText(p.fullName);
    return palabras.every((w) => objetivo.includes(w));
  }).slice(0, 25);
  if (encontradas.length === 0) return `Nadie coincide con "${nombre}".`;
  return encontradas.map(
    (p) => `${p.fullName}` + (p.active === false ? " (inactiva)" : "") + (p.pendingReview ? " (esperando revisi\xF3n)" : "") + (p.pendingIdentify ? " (sin nombre confirmado)" : "") + `
  id: ${p.id}`
  ).join("\n");
}
function informeHistorial(sessions, attendance, personas, personaId, hoy = /* @__PURE__ */ new Date()) {
  const persona = personas.find((p) => p.id === personaId);
  const suyas = attendance.filter((a) => a.memberId === personaId).sort((a, b) => toDate2(b.sessionDate).getTime() - toDate2(a.sessionDate).getTime());
  if (!persona && suyas.length === 0) {
    return `No existe ninguna persona con id ${personaId}.`;
  }
  const nombre = persona?.fullName ?? suyas[0]?.fullName ?? personaId;
  const cuenta = (t) => suyas.filter((a) => a.sessionType === t).length;
  const hechas = (t) => realizadas(sessions, hoy).filter((s) => s.type === t).length;
  const pct = (h, total) => total > 0 ? ` (${Math.round(h / total * 100)}% de ${total})` : "";
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
  const pendientes = personas.filter((p) => p.pendingReview || p.pendingIdentify);
  if (pendientes.length === 0) return "No hay nadie esperando revisi\xF3n.";
  return pendientes.map(
    (p) => `${p.fullName}` + (p.pendingIdentify ? " (sin nombre confirmado)" : "") + (p.createdByName ? ` \xB7 la registr\xF3 ${p.createdByName}` : "") + (p.sourceSessionDate ? ` \xB7 el ${fmtDate(p.sourceSessionDate)}` : "") + `
  id: ${p.id}`
  ).join("\n");
}

// mcp/src/herramientas.ts
var objeto = (properties = {}, required = []) => ({ type: "object", properties, required });
var txt = (description) => ({ type: "string", description });
var HERRAMIENTAS = [
  {
    name: "como_vamos",
    title: "\xBFC\xF3mo vamos?",
    description: 'Responde cu\xE1ntas personas est\xE1n viniendo \xDALTIMAMENTE a un tipo de reuni\xF3n (no en todo el a\xF1o): la cifra, si subi\xF3 o baj\xF3 frente al per\xEDodo anterior, el promedio de presentes por reuni\xF3n y el reparto en grupos (firmes, nuevas, van y vienen, se est\xE1n alejando) con los nombres. Es el mismo c\xE1lculo que muestra el apartado "\xBFC\xF3mo vamos?" del Panel de la app.',
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
      con_nombres: {
        type: "boolean",
        default: true,
        description: "Incluir los nombres de cada grupo."
      }
    }),
    async ejecutar(a) {
      const [sessions, attendance] = await Promise.all([
        cargarSesiones(),
        cargarAsistencia()
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
    name: "conteos",
    title: "Conteos generales",
    description: "Totales r\xE1pidos: personas en la lista (activas y totales), reuniones registradas por tipo, y cu\xE1ntas personas nuevas esperan revisi\xF3n.",
    inputSchema: objeto(),
    async ejecutar() {
      const [sessions, personas] = await Promise.all([
        cargarSesiones(),
        cargarPersonas()
      ]);
      return informeConteos(sessions, personas);
    }
  },
  {
    name: "reuniones",
    title: "Listar reuniones",
    description: "Las reuniones m\xE1s recientes, con fecha, tipo, modalidad, qui\xE9n coordin\xF3, cu\xE1ntas personas asistieron y si la sesi\xF3n sigue abierta. Devuelve el id de cada una para consultar su lista.",
    inputSchema: objeto({
      tipo: { type: "string", enum: ["pasos", "ego", "todas"], default: "todas" },
      limite: { type: "integer", minimum: 1, maximum: 100, default: 10 }
    }),
    async ejecutar(a) {
      const [sessions, attendance] = await Promise.all([
        cargarSesiones(),
        cargarAsistencia()
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
    inputSchema: objeto({ reunion_id: txt("id de la reuni\xF3n") }, ["reunion_id"]),
    async ejecutar(a) {
      const [sessions, attendance] = await Promise.all([
        cargarSesiones(),
        cargarAsistencia()
      ]);
      return informeAsistenciaReunion(sessions, attendance, String(a.reunion_id));
    }
  },
  {
    name: "buscar_persona",
    title: "Buscar una persona",
    description: "Busca personas por nombre (tolera acentos, may\xFAsculas y orden de las palabras) y devuelve su id para consultar el historial. No devuelve tel\xE9fonos ni notas.",
    inputSchema: objeto({ nombre: txt("Nombre o parte del nombre") }, ["nombre"]),
    async ejecutar(a) {
      return informeBuscarPersona(await cargarPersonas(), String(a.nombre));
    }
  },
  {
    name: "historial_persona",
    title: "Historial de una persona",
    description: 'Todas las veces que una persona ha asistido, separadas por tipo de reuni\xF3n, con su porcentaje de asistencia. El id se obtiene con "buscar_persona".',
    inputSchema: objeto({ persona_id: txt("id de la persona") }, ["persona_id"]),
    async ejecutar(a) {
      const [sessions, attendance, personas] = await Promise.all([
        cargarSesiones(),
        cargarAsistencia(),
        cargarPersonas()
      ]);
      return informeHistorial(sessions, attendance, personas, String(a.persona_id));
    }
  },
  {
    name: "por_revisar",
    title: "Personas esperando revisi\xF3n",
    description: "Las personas que una coordinadora agreg\xF3 en plena reuni\xF3n y que todav\xEDa no forman parte de la lista oficial, para que la administraci\xF3n las apruebe, las una con alguien que ya exist\xEDa o las descarte.",
    inputSchema: objeto(),
    async ejecutar() {
      return informePorRevisar(await cargarPersonas());
    }
  },
  {
    name: "refrescar",
    title: "Releer los datos",
    description: "Vac\xEDa la cach\xE9 de un minuto y vuelve a leer todo. \xDAtil si acaban de tomar asistencia y quieres los datos al segundo.",
    inputSchema: objeto(),
    async ejecutar() {
      limpiarCache();
      const [sessions, attendance] = await Promise.all([
        cargarSesiones(),
        cargarAsistencia()
      ]);
      return `Datos rele\xEDdos: ${sessions.length} reuniones y ${attendance.length} asistencias.`;
    }
  }
];
var CATALOGO = HERRAMIENTAS.map(({ name, title, description, inputSchema }) => ({
  name,
  title,
  description,
  inputSchema
}));
function buscarHerramienta(nombre) {
  return HERRAMIENTAS.find((h) => h.name === nombre);
}

// mcp/src/http.ts
var VERSION_PROTOCOLO = "2024-11-05";
var ok = (id, result) => ({ jsonrpc: "2.0", id, result });
var fallo = (id, code, message2) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message: message2 }
});
async function atender(p) {
  switch (p.method) {
    case "initialize":
      return ok(p.id, {
        protocolVersion: VERSION_PROTOCOLO,
        capabilities: { tools: {} },
        serverInfo: { name: "coordinacion-gemb", version: "2.0.0" }
      });
    // Las notificaciones no llevan respuesta.
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok(p.id, {});
    case "tools/list":
      return ok(p.id, { tools: CATALOGO });
    case "tools/call": {
      const nombre = String(p.params?.name ?? "");
      const herramienta = buscarHerramienta(nombre);
      if (!herramienta) return fallo(p.id, -32602, `No existe la herramienta "${nombre}".`);
      const args = p.params?.arguments ?? {};
      try {
        const texto = await herramienta.ejecutar(args);
        return ok(p.id, { content: [{ type: "text", text: texto }] });
      } catch (e) {
        const mensaje = e instanceof ConfigError || e instanceof AccesoError ? e.message : `No se pudo consultar: ${e instanceof Error ? e.message : String(e)}`;
        return ok(p.id, { content: [{ type: "text", text: mensaje }], isError: true });
      }
    }
    default:
      return fallo(p.id, -32601, `M\xE9todo no soportado: ${p.method}`);
  }
}
async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    res.status(200).json({ nombre: "coordinacion-gemb", mcp: VERSION_PROTOCOLO, estado: "en pie" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json(fallo(null, -32600, "Usa POST."));
    return;
  }
  const esperado = process.env.GEMB_MCP_TOKEN;
  if (!esperado) {
    res.status(503).json(
      fallo(null, -32e3, "Falta GEMB_MCP_TOKEN en el servidor: nadie puede consultar todav\xEDa.")
    );
    return;
  }
  const cabecera = req.headers.authorization;
  const recibido = (Array.isArray(cabecera) ? cabecera[0] : cabecera ?? "").replace(/^Bearer\s+/i, "").trim();
  if (recibido !== esperado) {
    res.setHeader("WWW-Authenticate", "Bearer");
    res.status(401).json(fallo(null, -32001, "Token inv\xE1lido o ausente."));
    return;
  }
  const cuerpo = req.body;
  const peticiones = Array.isArray(cuerpo) ? cuerpo : [cuerpo ?? {}];
  const respuestas = (await Promise.all(peticiones.map(atender))).filter(
    (r) => r !== null
  );
  if (respuestas.length === 0) {
    res.status(202).end();
    return;
  }
  res.status(200).json(Array.isArray(cuerpo) ? respuestas : respuestas[0]);
}
export {
  handler as default
};
