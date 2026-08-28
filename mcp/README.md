# MCP de Coordinación GEMB

Para que **Claude pueda consultar la app** y responder preguntas como *"¿cuántas
personas están haciendo Pasos últimamente?"*, *"¿quién dejó de venir?"* o
*"¿cuántas fueron el jueves pasado?"* — sin que tengas que entrar, exportar nada
ni contar a mano.

> **Solo lee.** No crea sesiones, no marca asistencia, no corrige fichas.
> Tampoco devuelve teléfonos ni las notas privadas de las personas.
> (La única excepción está explicada abajo, en "La única escritura".)

---

## Cómo entra a los datos, y por qué así

Entra **como una usuaria más de la app**, con correo y contraseña, y por lo
tanto **pasa por tus reglas de seguridad de Firestore** igual que cualquier
coordinadora.

Esto es a propósito, y es mejor que la alternativa habitual:

| | Llave de cuenta de servicio | Cuenta de la app (lo que usamos) |
| --- | --- | --- |
| ¿La deja crear tu organización? | ❌ No (está bloqueada) | ✅ Sí |
| ¿Respeta las reglas de Firestore? | ❌ Se las salta todas | ✅ Pasa por ellas |
| ¿Cómo se revoca? | Consola de Google | ✅ Desde la app: Usuarios → desactivar |
| ¿Hay un archivo que se pueda filtrar? | ⚠️ Sí | ✅ No |

---

## Puesta en marcha (una sola vez, ~10 minutos)

### Paso 1 — Activar el ingreso por correo en Firebase

[Consola de Firebase](https://console.firebase.google.com/) → proyecto
**coordinacion-gemb** → **Authentication** → pestaña **Sign-in method** →
**Email/Password** → **Habilitar** → Guardar.

> Es un interruptor. No tiene nada que ver con las claves de cuenta de servicio
> que tu organización bloquea.

### Paso 2 — Crear la cuenta de consultas

En la misma pantalla de **Authentication** → pestaña **Users** → **Add user**:

- Correo: `consultas@gimnasioemocionalmb.com` (o el que prefieras)
- Contraseña: una larga y que no uses en ningún otro sitio

Anótala: la vas a pegar una vez en el paso 4 y no la necesitas más.

### Paso 3 — Darle permiso dentro de la app

Abre la app como administradora → **Usuarios** → **Pre-autorizar por correo**
→ escribe ese mismo correo → rol **Coordinador(a)** → guardar.

Sin esto, la cuenta entra a Firebase pero las reglas no la dejan leer nada.

### Paso 4 — Guardar los datos en Vercel

[vercel.com](https://vercel.com) → proyecto **coordinacion-gemb** → **Settings**
→ **Environment Variables**. Agrega tres:

| Nombre | Valor |
| ------ | ----- |
| `GEMB_EMAIL` | el correo del paso 2 |
| `GEMB_PASSWORD` | la contraseña del paso 2 |
| `GEMB_MCP_TOKEN` | una contraseña larga que inventes; es la que protege el servidor |

Luego **Deployments** → en el último, menú `···` → **Redeploy** (para que tome
las variables nuevas).

### Paso 5 — Conectarlo a Claude

En [claude.ai](https://claude.ai) → **Configuración** → **Conectores** →
**Agregar conector personalizado**:

- URL: `https://coordinacion-gemb.vercel.app/api/mcp`
- Autenticación: cabecera `Authorization` con valor `Bearer TU_GEMB_MCP_TOKEN`

Listo. A partir de ahí funciona **en cualquier conversación**: desde el celular,
desde la web, desde donde sea.

---

## Comprobar en qué vas

Abre en el navegador **`https://coordinacion-gemb.vercel.app/api/mcp`**. Te
dice qué falta, paso por paso:

```json
{
  "estado": "en pie",
  "configuracion": [
    { "paso": "1. Cuenta de consultas configurada (GEMB_EMAIL / GEMB_PASSWORD)",
      "listo": false,
      "falta": "Agrégalas en Vercel → Settings → Environment Variables…" },
    { "paso": "2. Token que protege este servidor (GEMB_MCP_TOKEN)",
      "listo": false, "falta": "…" }
  ]
}
```

Cuando todo esté puesto, intenta entrar y leer de verdad, y lo dice:

```json
{ "estado": "en pie y funcionando",
  "3. Acceso a los datos": { "listo": true,
    "detalle": "Entra y lee correctamente (37 reuniones a la vista)." } }
```

Nunca muestra el valor de nada: solo si está puesto o no.

---

## Si algo no funciona

Cada mensaje dice qué arreglar:

| Lo que dice | Qué hacer |
| ----------- | --------- |
| *"Falta activar el ingreso por correo…"* | Paso 1. |
| *"No se pudo entrar como …"* | Paso 2: la cuenta no existe o la contraseña guardada no coincide. |
| *"…todavía no tiene permiso dentro de la app"* | Paso 3: falta pre-autorizar ese correo. |
| *"Faltan GEMB_EMAIL y GEMB_PASSWORD"* | Paso 4, y acuérdate de volver a desplegar. |
| *"Token inválido o ausente"* | El `Bearer` del paso 5 no coincide con `GEMB_MCP_TOKEN`. |
| *PERMISSION_DENIED* | La cuenta quedó desactivada en la app (Usuarios) o le quitaron el rol. |

**Para cortarle el acceso en cualquier momento:** app → **Usuarios** →
desactiva esa cuenta. Deja de leer al instante, sin tocar nada más.

---

## La única escritura

Las reglas exigen que exista `users/{uid}` con un rol para poder leer. Esta
cuenta nunca entra por la pantalla de la app, así que ese documento no se crea
solo: **el servidor lo crea una única vez**, la primera vez que consulta, y solo
funciona si antes hiciste el paso 3. Es la única escritura de todo el proyecto y
está en `rest.ts` (`registrarse`).

---

## Lo que puede responder

| Herramienta | Para qué sirve |
| ----------- | -------------- |
| `como_vamos` | **La principal.** Cuántas personas vienen últimamente, si subió o bajó, promedio por reunión y los grupos con nombres. |
| `conteos` | Totales: personas en la lista, reuniones hechas, cuántas esperan revisión. |
| `reuniones` | Las últimas reuniones con fecha, modalidad, coordinadora y asistentes. |
| `asistencia_reunion` | La lista de presentes de una reunión concreta. |
| `buscar_persona` | Encuentra a alguien por nombre (tolera tildes y orden de palabras). |
| `historial_persona` | Todas sus asistencias y su porcentaje. |
| `por_revisar` | Personas que agregó una coordinadora y aún no entran a la lista oficial. |
| `refrescar` | Vuelve a leer todo, por si acaban de tomar asistencia. |

Es **el mismo cálculo** que muestra el apartado "¿Cómo vamos?" del Panel: vive
en un solo sitio (`src/lib/activity.ts`), así que la app y Claude no pueden
decir números distintos.

---

## Para quien mantenga esto

- `mcp/src/http.ts` — el servidor por HTTP. JSON-RPC a mano y sin estado, que
  es lo que encaja con una función que se apaga entre llamadas.
- `api/mcp.js` — **generado**, no se edita a mano: es http.ts empaquetado con
  todo dentro (`npm run build:api`, incluido en `npm run build`). Va versionado
  porque Vercel compila cada archivo de api/ por separado y no arrastra los
  módulos de otras carpetas.
- `mcp/src/rest.ts` — entrada por Firebase Auth y lectura de Firestore por su
  API REST. **Sin dependencias**: solo `fetch`.
- `mcp/src/herramientas.ts` — el registro de herramientas, definido una vez y
  compartido por los dos servidores.
- `mcp/src/informes.ts` — el texto de cada respuesta. Lógica pura, probada con
  datos armados a mano.
- `mcp/src/index.ts` — el mismo servidor por terminal, para desarrollar.

Alternativa por terminal (útil para desarrollar):

```bash
cd mcp && npm install && npm run build
GEMB_EMAIL=… GEMB_PASSWORD=… node dist/index.js
```

El [`.mcp.json`](../.mcp.json) de la raíz lo deja registrado para Claude Code
local. Recuerda exportar las variables **antes** de abrir Claude Code: el
servidor las hereda de la terminal al arrancar.
