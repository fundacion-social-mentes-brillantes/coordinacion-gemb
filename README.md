# Asistencia GEMB

PWA (aplicación web instalable) para el **control de asistencia** de las
reuniones semanales de la fundación **Gimnasio Emocional Mentes Brillantes
(GEMB)**. Reemplaza la toma de asistencia en papel.

- Dos tipos de reunión: **Entrega de Pasos** y **Sala de Reducción del Ego**.
- Dos modalidades que se alternan cada semana: **Presencial** y **Virtual**.
- Pensada para usarse **desde el celular con una sola mano**.
- Funciona **sin conexión** y se sincroniza sola al reconectar.
- Todo se guarda en **Firebase** (única fuente de verdad).

---

## ✨ Qué hace

- **Toma de asistencia rapidísima**: se busca por nombre (búsqueda inteligente
  que tolera tildes, mayúsculas, orden de palabras y errores de tipeo) y se
  toca a la persona para marcarla presente. En tiempo real entre varios
  celulares y sin duplicados.
- **Walk-in**: agregar a una persona nueva en el momento y marcarla presente.
- **Sesiones**: crear reuniones (tipo + modalidad + fecha), abrirlas/cerrarlas.
- **Panel / reportes**: por sesión, por persona (con % de asistencia) y
  resumen anual (totales, únicos, por tipo, por modalidad y gráfico por mes).
  Exportación a **CSV** y **PDF**.
- **Gestión de personas** (admin): importar desde CSV/Excel con limpieza de
  acentos dañados y detección de duplicados; editar/activar/desactivar.
- **Gestión de usuarios** (admin): aprobar pendientes, asignar roles, y
  pre-autorizar coordinadoras por correo.

---

## 🚀 Cómo correr en tu computadora (local)

Necesitas [Node.js](https://nodejs.org) 18 o superior.

```bash
# 1. Instalar dependencias
npm install

# 2. Levantar en modo desarrollo (se abre en http://localhost:5173)
npm run dev

# 3. Compilar para producción (verifica tipos y genera /dist)
npm run build

# 4. Previsualizar la versión compilada
npm run preview
```

> En `localhost` el login con Google ya funciona sin configuración extra.
> El service worker (offline) **solo** se activa en la versión compilada
> (`build`/`preview`), no en `dev`.

---

## ✅ Pasos finales (para cuando vuelvas)

Estos 5 pasos los haces tú una sola vez. Son sencillos:

### 1) Publicar las reglas de seguridad de Firestore  ⚠️ imprescindible

Sin esto la app **no puede leer ni escribir** (el proyecto está en modo
producción).

1. Entra a la [consola de Firebase](https://console.firebase.google.com/) →
   proyecto **coordinacion-gemb**.
2. Menú **Firestore Database** → pestaña **Reglas** (Rules).
3. Borra lo que haya y **pega TODO el contenido del archivo
   [`firestore.rules`](./firestore.rules)**.
4. Botón **Publicar**.

### 2) Subir el proyecto a GitHub

Ya dejé el proyecto con un commit local listo (ver más abajo "Estado de Git").
Solo falta crear el repositorio en GitHub y subirlo:

```bash
# Crea un repositorio vacío en github.com (por ejemplo: coordinacion-gemb)
# y luego, dentro de la carpeta del proyecto:
git remote add origin https://github.com/TU_USUARIO/coordinacion-gemb.git
git branch -M main
git push -u origin main
```

### 3) Desplegar en Vercel

1. Entra a [vercel.com](https://vercel.com) e inicia sesión con GitHub.
2. **Add New → Project** → importa el repositorio `coordinacion-gemb`.
3. Vercel detecta Vite automáticamente. **No hay que configurar variables de
   entorno** (la config de Firebase ya está en el código).
4. **Deploy**.

### 4) Autorizar el dominio de Vercel en Firebase

Cuando Vercel te dé la URL (p. ej. `coordinacion-gemb.vercel.app`):

1. Firebase → **Authentication** → **Settings/Configuración** →
   **Dominios autorizados**.
2. **Agregar dominio** → escribe esa URL.

> Sin esto, el login de Google **fallará en producción** (en `localhost` ya
> funciona).

### 5) Primer uso

1. Entra a la app con **fundacionsocial@gimnasioemocionalmb.com** → quedas
   automáticamente como **super administrador**.
2. Ve a **Personas → Importar** y sube la base real de nombres (CSV o Excel).
3. Ve a **Usuarios** para **aprobar** a las coordinadoras (o pre-autorizarlas
   por correo antes de que ingresen).

---

## 👤 Roles y el super administrador

El rol de cada persona se guarda en `users/{uid}.role`:

| Rol           | Qué puede hacer                                                                 |
| ------------- | ------------------------------------------------------------------------------- |
| `super_admin` | Control total. Se asigna **automáticamente** al correo del super admin. No se puede borrar ni degradar. Puede crear/gestionar administradores. |
| `admin`       | Gestiona personas (importar/editar/desactivar), sesiones y usuarios (aprobar pendientes, asignar rol, crear coordinadoras). Ve todo el panel. |
| `coordinador` | Crea/abre sesiones, marca asistencia, agrega walk-ins. Ve la asistencia en vivo y el panel. |
| `pending`     | Rol inicial de quien entra por primera vez. No puede hacer nada hasta ser aprobado. |

**Super administrador:** es el correo definido en `SUPER_ADMIN_EMAIL` dentro de
[`src/lib/firebase.ts`](./src/lib/firebase.ts) (hoy
`fundacionsocial@gimnasioemocionalmb.com`). La primera vez que ese correo
ingresa, se crea/actualiza como `super_admin`. Las reglas de Firestore impiden
que alguien lo degrade, desactive o borre. Si algún día cambia el correo, hay
que actualizarlo en **dos lugares**: `src/lib/firebase.ts` y `firestore.rules`
(función `superEmail()`), y volver a publicar las reglas.

**Flujo de acceso:** cualquiera entra con Google → si no es el super admin,
queda como `pending` y ve la pantalla "Tu acceso está pendiente". Un
admin/super lo aprueba y le asigna rol. También se puede **pre-autorizar por
correo** (Usuarios → "Pre-autorizar por correo"): así, al ingresar por primera
vez, la persona ya queda con el rol asignado.

---

## 🖼️ Reemplazar el logo y los iconos

Todo lo visual es **placeholder** y está claramente marcado. Para poner el
logo real:

| Archivo                             | Qué es                                        |
| ----------------------------------- | --------------------------------------------- |
| `public/logo.svg`                   | Logo (formato vectorial).                     |
| `public/favicon.svg`                | Icono de la pestaña del navegador.            |
| `public/pwa-192x192.png`            | Icono PWA 192×192.                            |
| `public/pwa-512x512.png`            | Icono PWA 512×512.                            |
| `public/maskable-512x512.png`       | Icono "maskable" (Android, con margen).       |
| `public/apple-touch-icon.png`       | Icono para iPhone/iPad.                       |
| `src/components/Logo.tsx`           | Logo que se muestra **dentro** de la app.     |

Los PNG de placeholder se generan con `npm run gen:icons` (edita
`scripts/gen-icons.mjs` si quieres otros colores). Cuando tengas el logo real,
reemplaza los archivos anteriores por las imágenes definitivas (mismos nombres
y tamaños) y actualiza `src/components/Logo.tsx`.

Los **colores de la marca** están centralizados en
[`tailwind.config.js`](./tailwind.config.js) (`primary` y `accent`): cámbialos
ahí y se aplican en toda la app.

---

## 🎨 Temas (Verde / Pink / Dorado)

La app tiene **3 temas** que la usuaria cambia con los tres círculos de color
en la barra superior (y en la pantalla de ingreso):

- **Verde** (por defecto)
- **Pink Brillante** (rosa)
- **Noche Dorada** (oscuro con dorado)

La elección se recuerda en cada dispositivo. Todos los colores están
centralizados en [`src/index.css`](./src/index.css) (bloques `[data-theme='…']`)
y en [`tailwind.config.js`](./tailwind.config.js): para ajustar un tono, edítalo
ahí y se aplica en toda la app.

## 📱 Instalar como app (PWA)

- **Android (Chrome):** aparece el botón **"Instalar app"** dentro de la app,
  o desde el menú del navegador → "Instalar aplicación".
- **iPhone/iPad (Safari):** botón **Compartir** → **"Añadir a pantalla de
  inicio"** (iOS no muestra el botón automático).

Una vez instalada se abre a pantalla completa, como una app normal, y funciona
sin conexión.

---

## 🧪 Datos de prueba (opcional)

En [`seed/personas-ejemplo.csv`](./seed/personas-ejemplo.csv) hay ~25 personas
de ejemplo (con tildes, para probar la búsqueda). Para usarlas: entra como
admin → **Personas → Importar** → sube ese archivo. Luego crea una sesión y
prueba la toma de asistencia.

---

## 🗂️ Modelo de datos (Firestore)

- `users/{uid}`: `{ email, displayName, photoURL, role, active, createdAt }`
- `members/{memberId}`: `{ fullName, firstName, lastName, searchName, aliases[], phone?, notes?, active, createdAt, createdBy }`
  - `searchName` = nombre normalizado (sin acentos, minúsculas) para búsqueda instantánea.
- `sessions/{sessionId}`: `{ type, modality, date, status, createdBy, createdByName, createdAt, presentCount }`
- `sessions/{sessionId}/attendance/{memberId}`: `{ memberId, fullName, status, checkedInAt, checkedInBy, checkedInByName, sessionId, sessionType, modality, sessionDate }`
  - El **ID del documento es el `memberId`** → marcar = crear, desmarcar =
    borrar; nunca hay duplicados aunque varias personas marquen a la vez.
- `invites/{correoEnMinúsculas}`: `{ email, role, createdBy, createdByName, createdAt }`
  - Pre-autorizaciones para asignar rol antes del primer ingreso.

> Los campos de la sesión se **denormalizan** dentro de cada asistencia para
> que el panel/reportes se calculen rápido y **sin índices personalizados**.

---

## 🛠️ Stack técnico

Vite + React + TypeScript · Tailwind CSS · `vite-plugin-pwa` (service worker,
`autoUpdate`) · Firebase (Firestore con persistencia offline + Auth con Google)
· React Router · Fuse.js (búsqueda difusa) · date-fns (fechas en español) ·
PapaParse (CSV) · jsPDF + jspdf-autotable (PDF) · SheetJS/xlsx (leer Excel).

---

## 🧭 Decisiones tomadas de forma autónoma

Como el proyecto se construyó sin poder consultar dudas menores, se tomaron
estas decisiones (todas fáciles de cambiar):

1. **Rutas en español**: `/sesiones`, `/panel`, `/personas`, `/usuarios`.
2. **Paleta**: verde-turquesa (principal) + azul sereno (acento), editable en
   `tailwind.config.js`.
3. **Contador de presentes** (`presentCount`): se mantiene solo, con un
   incremento atómico en el mismo lote al marcar/desmarcar (funciona offline).
   Además, la hora de check-in se guarda con la hora real del dispositivo, para
   que sea correcta aunque se marque sin conexión. El número exacto en vivo de
   la pantalla de asistencia se calcula directo desde la lista de asistencia.
4. **Pre-autorización por correo** (`invites`): forma práctica de "crear
   coordinadoras" antes de que ingresen (Firebase Auth no permite crear la
   cuenta antes del primer login).
5. **Reportes sin índices personalizados**: se leen todas las asistencias y se
   agregan en el navegador (el volumen esperado es pequeño), para que no tengas
   que crear índices a mano en Firebase.
6. **`npm run build` verifica tipos** (`tsc --noEmit`) antes de compilar.

---

## 🔒 Nota sobre `npm audit`

`npm install` reporta algunas alertas, en su mayoría de la librería **`xlsx`
(SheetJS)**, que solo se usa en el **importador** (pantalla exclusiva de
administradores, con archivos de confianza). No afectan el uso normal. Si más
adelante quieres eliminarlas, SheetJS recomienda instalar su versión oficial
desde su propio CDN; mientras tanto, la app funciona con normalidad.

---

## 📦 Estado de Git

El repositorio se inicializó y se hizo un **commit local** con todo el proyecto.
En esta máquina **no había credenciales de GitHub** (`gh` no está instalado y no
hay token), por eso el `push` queda pendiente para ti (ver **Paso 2** arriba).
