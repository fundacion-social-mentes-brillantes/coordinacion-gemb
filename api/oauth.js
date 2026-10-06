// src/lib/oauthRedirect.ts
var DOMINIOS = ["claude.ai", "claude.com", "anthropic.com"];
var LOCALES = ["localhost", "127.0.0.1", "::1"];
function redirectPermitido(uri) {
  let u;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (LOCALES.includes(host)) {
    return u.protocol === "http:" || u.protocol === "https:";
  }
  if (u.protocol !== "https:") return false;
  return DOMINIOS.some((d) => host === d || host.endsWith(`.${d}`));
}
var DESTINOS_PERMITIDOS = [...DOMINIOS, ...LOCALES].join(", ");

// mcp/src/sobre.ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
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
  return createHash("sha256").update(s).digest();
}
var esSobre = (s) => s.startsWith(PREFIJO);
function sellar(tipo, datos) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", clave(), iv);
  c.setAAD(Buffer.from(tipo));
  const cuerpo2 = Buffer.concat([c.update(JSON.stringify(datos), "utf8"), c.final()]);
  return PREFIJO + Buffer.concat([iv, cuerpo2, c.getAuthTag()]).toString("base64url");
}
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

// mcp/src/oauth.ts
var RAIZ = "https://coordinacion-gemb.vercel.app";
var RECURSO = `${RAIZ}/api/mcp`;
function parametros(req) {
  try {
    return new URL(req.url ?? "", RAIZ).searchParams;
  } catch {
    return new URLSearchParams();
  }
}
function cuerpo(req) {
  const b = crudo(req);
  const salida = {};
  for (const [k, v] of Object.entries(b)) {
    salida[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return salida;
}
function crudo(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === "string") {
    const t = b.trim();
    if (!t) return {};
    if (t.startsWith("{")) {
      try {
        const j = JSON.parse(t);
        if (j && typeof j === "object") return j;
      } catch {
      }
    }
    return Object.fromEntries(new URLSearchParams(t));
  }
  if (typeof b === "object") return b;
  return {};
}
function metadatosServidor() {
  return {
    issuer: RAIZ,
    authorization_endpoint: `${RAIZ}/api/oauth/authorize`,
    token_endpoint: `${RAIZ}/api/oauth/token`,
    registration_endpoint: `${RAIZ}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["coordinacion"]
  };
}
function metadatosRecurso() {
  return {
    resource: RECURSO,
    authorization_servers: [RAIZ],
    scopes_supported: ["coordinacion"],
    bearer_methods_supported: ["header"]
  };
}
function listaDeTextos(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  if (typeof v !== "string") return [];
  const t = v.trim();
  if (!t) return [];
  if (t.startsWith("[")) {
    try {
      const j = JSON.parse(t);
      if (Array.isArray(j)) return j.filter((x) => typeof x === "string");
    } catch {
    }
  }
  return [t];
}
function registrarCliente(datos) {
  const redirects = listaDeTextos(datos.redirect_uris);
  return {
    client_id: `gemb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    client_id_issued_at: Math.floor(Date.now() / 1e3),
    redirect_uris: redirects,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    client_name: typeof datos.client_name === "string" ? datos.client_name : "Cliente MCP"
  };
}
var RETO_VALIDO = /^[A-Za-z0-9_-]{43}$/;
async function sha256Base64Url(texto) {
  const datos = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest("SHA-256", datos);
  return Buffer.from(hash).toString("base64url");
}
function irAAutorizar(req) {
  const p = parametros(req);
  const redirect = p.get("redirect_uri");
  if (!redirect) return { error: "Falta redirect_uri." };
  if (!redirectPermitido(redirect)) {
    return { error: "Esa direcci\xF3n de retorno no est\xE1 autorizada." };
  }
  const metodo = p.get("code_challenge_method") ?? "plain";
  if (metodo !== "S256" || !RETO_VALIDO.test(p.get("code_challenge") ?? "")) {
    return { error: "Hace falta PKCE con code_challenge_method=S256." };
  }
  const destino = new URL(`${RAIZ}/autorizar`);
  destino.searchParams.set("redirect_uri", redirect);
  if (p.get("state")) destino.searchParams.set("state", p.get("state"));
  if (p.get("code_challenge")) {
    destino.searchParams.set("code_challenge", p.get("code_challenge"));
  }
  return { destino: destino.toString() };
}
function aprobar(datos) {
  const llave = typeof datos.llave === "string" ? datos.llave.trim() : "";
  const redirect = typeof datos.redirect_uri === "string" ? datos.redirect_uri : "";
  const reto = typeof datos.code_challenge === "string" ? datos.code_challenge : "";
  const state = typeof datos.state === "string" ? datos.state : "";
  if (llave.length < 20) return { error: "Falta la sesi\xF3n. Vuelve a entrar con Google." };
  if (!redirect || !redirectPermitido(redirect)) {
    return { error: "Esa direcci\xF3n de retorno no est\xE1 autorizada." };
  }
  if (!RETO_VALIDO.test(reto)) {
    return { error: "Falta informaci\xF3n de seguridad (PKCE). Vuelve a intentarlo desde Claude." };
  }
  const codigo = { llave, reto, destino: redirect, exp: Date.now() + 5 * 6e4 };
  const destino = new URL(redirect);
  destino.searchParams.set("code", sellar("codigo", codigo));
  if (state) destino.searchParams.set("state", state);
  return { destino: destino.toString() };
}
async function canjearCodigo(req) {
  const datos = { ...Object.fromEntries(parametros(req)), ...cuerpo(req) };
  if (datos.grant_type !== "authorization_code") {
    return { error: "unsupported_grant_type", detalle: "Solo se admite authorization_code." };
  }
  if (!datos.code) {
    return { error: "invalid_request", detalle: "Falta el c\xF3digo." };
  }
  const codigo = abrir("codigo", datos.code);
  if (!codigo) {
    return { error: "invalid_grant", detalle: "El c\xF3digo no es v\xE1lido." };
  }
  if (typeof codigo.exp !== "number" || Date.now() > codigo.exp) {
    return { error: "invalid_grant", detalle: "El c\xF3digo caduc\xF3. Vuelve a conectar." };
  }
  if (datos.redirect_uri && datos.redirect_uri !== codigo.destino) {
    return { error: "invalid_grant", detalle: "La direcci\xF3n de retorno no coincide." };
  }
  const verificador = datos.code_verifier;
  if (!verificador) {
    return { error: "invalid_request", detalle: "Falta code_verifier." };
  }
  if (await sha256Base64Url(verificador) !== codigo.reto) {
    return { error: "invalid_grant", detalle: "El code_verifier no coincide." };
  }
  const acceso = { llave: codigo.llave, desde: Date.now() };
  return {
    ok: {
      access_token: sellar("acceso", acceso),
      token_type: "Bearer",
      // Por dentro, la sesión se renueva sola en cada consulta. Se anuncia
      // una hora, como siempre, para que el cliente no la cachee de más.
      expires_in: 3600,
      scope: "coordinacion"
    }
  };
}
async function atenderOauth(req, res, ruta) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  try {
    await rutear(req, res, ruta);
  } catch (e) {
    if (e instanceof SinSecretoError) {
      res.status(500).json({ error: "server_error", error_description: e.message });
      return;
    }
    throw e;
  }
}
async function rutear(req, res, ruta) {
  switch (ruta) {
    case "as-metadata":
      res.status(200).json(metadatosServidor());
      return;
    case "pr-metadata":
      res.status(200).json(metadatosRecurso());
      return;
    case "register":
      res.status(201).json(registrarCliente(crudo(req)));
      return;
    case "authorize": {
      const r = irAAutorizar(req);
      if ("error" in r) {
        res.status(400).json({ error: "invalid_request", error_description: r.error });
        return;
      }
      res.setHeader("Location", r.destino);
      res.status(302).end();
      return;
    }
    case "aprobar": {
      if (req.method !== "POST") {
        res.status(405).json({ error: "invalid_request", error_description: "Usa POST." });
        return;
      }
      const r = aprobar(crudo(req));
      if ("error" in r) {
        res.status(400).json({ error: "invalid_request", error_description: r.error });
        return;
      }
      res.status(200).json(r);
      return;
    }
    case "token": {
      const r = await canjearCodigo(req);
      if ("error" in r) {
        res.status(400).json({ error: r.error, error_description: r.detalle });
        return;
      }
      res.status(200).json(r.ok);
      return;
    }
    default:
      res.status(404).json({ error: "not_found" });
  }
}

// mcp/src/oauth-http.ts
async function handler(req, res) {
  const ruta = new URL(req.url ?? "", "https://x").searchParams.get("ruta") ?? "";
  await atenderOauth(req, res, ruta);
}
export {
  handler as default
};
