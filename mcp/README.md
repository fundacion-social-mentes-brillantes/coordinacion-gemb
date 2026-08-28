# MCP de Coordinación GEMB

Un puente para que **Claude pueda consultar la app** y responder preguntas
como *"¿cuántas personas están haciendo Pasos últimamente?"*, *"¿quién dejó de
venir?"* o *"¿cuántas fueron el jueves pasado?"* — sin que tengas que entrar,
exportar nada ni contar a mano.

> **Dónde funciona:** en Claude Code corriendo **en tu computador**. En Claude
> Code web (claude.ai/code) el servidor arranca dentro de un contenedor
> desechable que no tiene tu sesión de Google ni sobrevive a la sesión, así que
> ahí no puede leer nada. Para esos casos está el botón **"Copiar resumen como
> texto"** del apartado ¿Cómo vamos?: un toque y se lo pegas a Claude.

> **Solo lee. Nunca escribe.** La app tiene reglas cuidadas sobre quién puede
> marcar asistencia y cuándo (sesión abierta o cerrada, el rol de cada quien,
> la bandeja de revisión de personas nuevas). Escribir desde aquí se las
> saltaría todas. Tampoco devuelve teléfonos ni las notas privadas.

---

## Lo que puede responder

| Herramienta | Para qué sirve |
| ----------- | -------------- |
| `como_vamos` | **La principal.** Cuántas personas están viniendo últimamente, si subió o bajó, el promedio por reunión y los grupos (firmes, nuevas, van y vienen, se están alejando) con nombres. |
| `conteos` | Totales rápidos: personas en la lista, reuniones hechas, cuántas esperan revisión. |
| `reuniones` | Las últimas reuniones con fecha, modalidad, quién coordinó y cuántas fueron. |
| `asistencia_reunion` | La lista de presentes de una reunión concreta. |
| `buscar_persona` | Encuentra a alguien por nombre (tolera tildes y orden de palabras). |
| `historial_persona` | Todas sus asistencias y su porcentaje. |
| `por_revisar` | Las personas que agregó una coordinadora y aún no entran a la lista oficial. |
| `refrescar` | Vuelve a leer todo, por si acaban de tomar asistencia. |

Es **el mismo cálculo** que muestra el apartado "¿Cómo vamos?" del Panel: la
lógica vive en un solo sitio (`src/lib/activity.ts`), así que la app y Claude
nunca van a decir números distintos.

---

## Puesta en marcha (una sola vez)

### 1) Dar permiso de entrada — **con tu propia cuenta** (recomendado)

No hace falta descargar ninguna llave. Entras una vez con tu cuenta de Google
y el permiso se queda guardado en tu computador.

1. Instala la herramienta `gcloud`:
   [cloud.google.com/sdk/docs/install](https://cloud.google.com/sdk/docs/install)
2. En la terminal:

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project coordinacion-gemb
```

Se abre el navegador, inicias sesión con la cuenta de la fundación y ya está.

**Por qué así y no con una "clave privada":** muchas organizaciones tienen
prohibido crear claves de cuenta de servicio (el botón *Generar nueva clave
privada* no funciona), y con razón: ese archivo abre la base de datos entera
y cualquiera que lo consiga entra. Con este método **no existe ningún archivo
que se pueda filtrar ni compartir por error**, y puedes revocar el permiso
cuando quieras con `gcloud auth application-default revoke`.

> Necesitas que tu cuenta tenga permiso de lectura en el proyecto de Firebase.
> Si eres quien administra **coordinacion-gemb**, ya lo tienes.

<details>
<summary>Alternativa: llave de cuenta de servicio (solo si tu organización la permite)</summary>

1. [Consola de Firebase](https://console.firebase.google.com/) → proyecto
   **coordinacion-gemb** → rueda dentada → **Configuración del proyecto** →
   **Cuentas de servicio** → **Generar nueva clave privada**.
2. Guarda el `.json` **fuera** de la carpeta del proyecto.
3. `export GEMB_SERVICE_ACCOUNT="/ruta/a/la-llave.json"`

⚠️ Ese archivo se salta las reglas de seguridad de Firestore. Trátalo como una
contraseña: nunca lo subas a GitHub ni lo mandes por WhatsApp. Si se te escapa,
bórralo desde esa misma pantalla.

</details>

### 2) Instalar y compilar

Desde la carpeta del proyecto, en la terminal:

```bash
cd mcp
npm install
npm run build
```

### 3) Listo

El archivo [`.mcp.json`](../.mcp.json) de la raíz del proyecto ya deja el
servidor registrado. Al abrir Claude Code dentro de esta carpeta, aparece
`coordinacion-gemb` entre los servidores disponibles (`/mcp` para verlo).

Si prefieres registrarlo a mano:

```bash
claude mcp add coordinacion-gemb -- node /ruta/al/proyecto/mcp/dist/index.js
```

---

> **Ojo con el orden.** Si haces `gcloud auth …` (o exportas la variable de la
> llave) *después* de tener Claude Code abierto, no se entera: ciérralo y
> vuelve a abrirlo.
>
> Por eso el `.mcp.json` **no** declara nada en un bloque `env`: si lo hiciera,
> pisaría lo que tengas en tu terminal. (Lo intenté así al principio y rompía
> justo el caso que quería facilitar.)

---

## Si algo no funciona

| Lo que dice | Qué hacer |
| ----------- | --------- |
| *"No hay credenciales para entrar a Firebase"* | Falta el paso 1, o lo hiciste con Claude Code ya abierto. Ejecuta `gcloud auth application-default login` y reinicia Claude Code. |
| *"La variable GEMB_SERVICE_ACCOUNT llegó sin sustituir"* | Alguien puso un bloque `env` con `${...}` en el `.mcp.json`. Quítalo. |
| *"No se pudo leer la llave en …"* | La ruta no existe o está mal escrita. Comprueba dónde guardaste el `.json`. |
| *"no contiene un JSON … válido"* | El archivo no es la llave de Firebase (o se dañó al copiarlo). |
| *PERMISSION_DENIED* al consultar | Tu cuenta de Google no tiene permiso de lectura en el proyecto **coordinacion-gemb**, o falta el `set-quota-project` del paso 1. |

Para revocar el permiso en cualquier momento:

```bash
gcloud auth application-default revoke
```

---

## Comprobar que funciona

```bash
cd mcp
npm start
```

Si la llave está bien, se queda esperando en silencio (es lo normal: habla por
la entrada estándar). Si falta o está mal, lo dice con todas sus letras.

---

## Para quien mantenga esto

- `src/firestore.ts` — conexión y lectura, con caché de 1 minuto para no
  releer toda la asistencia en cada pregunta de una misma conversación.
- `src/informes.ts` — el texto de cada herramienta. **Lógica pura**, sin
  Firebase ni protocolo, para poder probarla con datos armados a mano.
- `src/index.ts` — el servidor MCP: declara las herramientas y poco más.
- `npm run typecheck` verifica tipos; `npm run build` genera `dist/index.js`.

Reutiliza `src/lib/activity.ts`, `dates.ts`, `normalize.ts` y `constants.ts`
de la app, a propósito: si algún día cambia la definición de "firme" o de
"nueva", cambia en los dos sitios a la vez.
