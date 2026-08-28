# MCP de Coordinación GEMB

Para poder preguntarle a Claude por la asistencia sin entrar a la app:
*"¿cuántas personas están haciendo Pasos últimamente?"*, *"¿quién dejó de
venir?"*, *"¿cuántas fueron el jueves?"*.

**Cada persona lo conecta a su propio Claude con su propia llave.** Lo que
Claude puede hacer depende de quién es esa persona en la app.

---

## 🔑 Quién puede qué

| | **Coordinador(a)** | **Administrador(a)** |
| --- | :-: | :-: |
| Ver reuniones y asistencia | ✅ | ✅ |
| Ver cómo va el grupo (*¿Cómo vamos?*) | ✅ | ✅ |
| Ver el historial de UNA persona | ❌ | ✅ |
| Ver la bandeja de revisión | ❌ | ✅ |
| Ver conteos generales | ❌ | ✅ |
| **Crear reuniones** | ❌ | ✅ |
| **Marcar / quitar asistencia** | ❌ | ✅ |
| **Cerrar o reabrir reuniones** | ❌ | ✅ |
| **Aprobar personas nuevas** | ❌ | ✅ |

> ### Coordinación: **SOLO LECTURA**
> Puede consultar, pero **no puede cambiar absolutamente nada** desde Claude.
> Ni marcar asistencia, ni crear reuniones, ni tocar fichas. Eso se sigue
> haciendo en la app, como siempre.
>
> ### Administración: **LECTURA Y ESCRITURA**
> Puede consultar todo y además registrar y corregir — siempre con una
> confirmación de por medio (ver abajo).

Nadie ve teléfonos ni las notas privadas de las fichas. Ningún rol, nunca.

### Esto se sostiene en dos puertas, no en una

1. **El rol filtra las herramientas.** A una coordinadora ni siquiera se le
   ofrecen las de escritura: no aparecen en su lista.
2. **Las reglas de Firestore filtran los datos.** Aunque alguien se saltara la
   primera puerta, seguiría pudiendo hacer exactamente lo que su cuenta puede
   hacer en la app, ni más ni menos. No hay permisos duplicados aquí que se
   puedan desincronizar con los de la app.

---

## ✍️ Las escrituras van en dos pasos

Ninguna operación cambia nada de golpe. Primero se prepara un **borrador**:

```
BORRADOR — todavía no se ha guardado nada.

MARCAR como presente:
  María Fernanda Rodríguez
  en Entrega de Pasos del 20 ago 2026 (Virtual)

Si está bien, confírmalo con "confirmar_operacion" usando:
confirmacion_id: eyJvcCI6Im1hcmNhcl9wcmVzZW50ZSIs…

Caduca en 15 minutos.
```

Solo después de que la persona lo aprueba se ejecuta. Escribir en la base de
una fundación no debería poder pasar por un malentendido en una frase.

---

## Puesta en marcha (cada persona, una vez, ~2 minutos)

**No hay que configurar nada en Firebase, ni en Vercel, ni pedirle permiso a
nadie.** Si ya entras a la app, ya puedes conectarlo.

1. Entra a la app → **Sesiones** (o **Panel**) → **🤖 Conectar con Claude**
2. Toca **Copiar mi llave**
3. En [claude.ai](https://claude.ai) → Configuración → Conectores → *Agregar
   conector personalizado*:
   - URL: `https://coordinacion-gemb.vercel.app/api/mcp`
   - Cabecera `Authorization` con valor `Bearer ` + tu llave
4. Pregúntale *"¿con qué cuenta estás conectado?"* — debe responder con tu
   nombre y tu rol.

Funciona en **cualquier Claude**: el del celular, el de la web, el de
escritorio, Claude Code. Es el mismo conector.

### Para cortar el acceso

- **Tú mismo:** sal de la app con el botón de salir. La llave deja de servir al
  instante.
- **La administración:** app → **Usuarios** → desactivar esa cuenta. Deja de
  funcionar de inmediato, porque las reglas exigen `active == true`.

---

## Cómo entra a los datos, y por qué así

Entra **como la propia persona**, reutilizando la sesión que ya abrió con
Google en la app. Comparado con lo habitual (una llave de administrador del
proyecto):

| | Llave de cuenta de servicio | Cuenta de cada persona (lo que usamos) |
| --- | --- | --- |
| ¿La deja crear tu organización? | ❌ No, está bloqueada | ✅ No hace falta |
| ¿Respeta las reglas de Firestore? | ❌ Se las salta todas | ✅ Pasa por ellas |
| ¿Distingue coordinación de administración? | ❌ Todos verían todo | ✅ Sí, por sí solo |
| ¿Hay secretos guardados en el servidor? | ⚠️ Sí | ✅ Ninguno |
| ¿Cómo se revoca? | Consola de Google | ✅ Desde la app |

El servidor **no guarda ningún secreto**: la llave llega en cada consulta, se
canjea por un permiso de una hora y se descarta. Si el servidor se viera
comprometido, no habría nada que robar.

---

## Si algo no funciona

| Lo que dice | Qué hacer |
| ----------- | --------- |
| *"Falta la llave personal"* | No pegaste la cabecera `Authorization`, o le falta el `Bearer `. |
| *"La llave ya no sirve"* | Saliste de la app. Entra otra vez y copia una nueva. |
| *"Tu acceso está desactivado"* | La administración desactivó tu cuenta en Usuarios. |
| *"Tu acceso está pendiente"* | Todavía no te han aprobado en la app. |
| *"… es solo para administración"* | Correcto: entras como coordinador(a). |
| *"El borrador caducó"* | Pasaron más de 15 minutos. Prepáralo de nuevo. |

Comprueba que el servidor está en pie abriendo
`https://coordinacion-gemb.vercel.app/api/mcp` en el navegador.

---

## Lo que puede responder

**Consulta (todos los roles):** `quien_soy`, `como_vamos`, `reuniones`,
`asistencia_reunion`, `refrescar`.

**Consulta (solo administración):** `conteos`, `buscar_persona`,
`historial_persona`, `por_revisar`.

**Escritura (solo administración, en dos pasos):**
`preparar_crear_reunion`, `preparar_marcar_presente`,
`preparar_quitar_presente`, `preparar_cerrar_reunion`,
`preparar_aprobar_persona`, y `confirmar_operacion` para ejecutar.

Los informes usan **el mismo cálculo** que el apartado "¿Cómo vamos?" del
Panel: vive en un solo sitio (`src/lib/activity.ts`), así que la app y Claude
no pueden decir números distintos.

---

## Para quien mantenga esto

- `mcp/src/rest.ts` — entrada por Firebase Auth (canjea la llave de la persona)
  y lectura/escritura de Firestore por su API REST. **Sin dependencias**: solo
  `fetch`. Las coordinadoras no pasan de `exigirAdmin`.
- `mcp/src/herramientas.ts` — el registro de herramientas y su alcance
  (`todos` / `admin` / `escribir`).
- `mcp/src/escrituras.ts` — las operaciones que modifican, con el borrador y la
  confirmación. El borrador viaja dentro del `confirmacion_id`, así que el
  servidor no recuerda nada entre llamadas.
- `mcp/src/informes.ts` — el texto de cada respuesta. Lógica pura, probada con
  datos armados a mano.
- `mcp/src/http.ts` — el servidor HTTP. **Fuente**; lo que se despliega es
  `api/mcp.js`, generado con `npm run build:api` (Vercel compila cada archivo
  de `api/` por separado y no arrastra módulos de otras carpetas).
- `mcp/src/index.ts` — el mismo servidor por terminal (`GEMB_LLAVE=… node
  dist/index.js`), para desarrollar.
