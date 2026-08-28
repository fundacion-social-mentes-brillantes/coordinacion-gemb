# MCP de Coordinación GEMB

Un puente para que **Claude pueda consultar la app** y responder preguntas
como *"¿cuántas personas están haciendo Pasos últimamente?"*, *"¿quién dejó de
venir?"* o *"¿cuántas fueron el jueves pasado?"* — sin que tengas que entrar,
exportar nada ni contar a mano.

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

### 1) Descargar la llave de acceso

Este servidor entra a Firebase como *administrador*, así que necesita una
llave propia:

1. Entra a la [consola de Firebase](https://console.firebase.google.com/) →
   proyecto **coordinacion-gemb**.
2. Rueda dentada (arriba a la izquierda) → **Configuración del proyecto**.
3. Pestaña **Cuentas de servicio**.
4. Botón **Generar nueva clave privada** → **Generar clave**.
5. Se descarga un archivo `.json`. **Guárdalo fuera de la carpeta del
   proyecto** (por ejemplo en tu carpeta personal) y no se lo pases a nadie.

> ⚠️ Esa llave abre la base de datos entera saltándose las reglas de seguridad.
> Trátala como una contraseña: **nunca** la subas a GitHub ni la mandes por
> WhatsApp. Si se te escapa, vuelve a esa pantalla y bórrala (puedes generar
> otra cuando quieras).

### 2) Instalar y compilar

Desde la carpeta del proyecto, en la terminal:

```bash
cd mcp
npm install
npm run build
```

### 3) Decirle a Claude dónde está la llave

En la misma terminal, antes de abrir Claude Code:

```bash
export GEMB_SERVICE_ACCOUNT="/ruta/donde/guardaste/la-llave.json"
```

Para no repetirlo cada vez, añade esa línea al final de tu `~/.zshrc` (Mac) o
`~/.bashrc` (Linux).

> También acepta `GOOGLE_APPLICATION_CREDENTIALS`, si ya lo usas para otras
> herramientas de Google.

### 4) Listo

El archivo [`.mcp.json`](../.mcp.json) de la raíz del proyecto ya deja el
servidor registrado. Al abrir Claude Code dentro de esta carpeta, aparece
`coordinacion-gemb` entre los servidores disponibles (`/mcp` para verlo).

Si prefieres registrarlo a mano:

```bash
claude mcp add coordinacion-gemb -- node /ruta/al/proyecto/mcp/dist/index.js
```

---

## Comprobar que funciona

```bash
cd mcp
GEMB_SERVICE_ACCOUNT=/ruta/a/la-llave.json npm start
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
