# Barra lateral de la app: sesiones por proyecto y perfil

Fecha: 2026-09-23 · Ámbito: `rust/sens-app` (Rust + `ui/index.html`)

## Tarea del usuario

Volver a una conversación anterior de cualquier proyecto sin tener que acordarse
de en qué carpeta estaba. Lo más importante de la barra es la lista de sesiones;
la acción focal es abrir una.

## Problemas de hoy

- La barra solo lista las sesiones de la carpeta abierta (`<root>/.sens/sessions`).
  Las de otros proyectos existen en disco pero no se ven.
- Elegir carpeta o pulsar `+` crea una sesión aunque no se escriba nada, y la
  app no recuerda la carpeta al arrancar: la lista se llena de "Sesión vacía".
- Cada fila ocupa dos líneas y ~52 px.
- No hay perfil, ni menú, ni ajustes.

## Fuera de alcance

- Mover proveedor, modelo, clave y comando del compositor a Ajustes (spec aparte).
- Tema claro (spec aparte). La entrada "Tema" no aparece en el menú hasta entonces.
- Borrar, renombrar o fijar sesiones. Olvidar un proyecto de la lista.
- El instalador que pedirá el nombre. Solo se fija el fichero que escribirá.

## Decisión: registro global de proyectos (opción A)

Las sesiones se quedan donde están, en `<root>/.sens/sessions/*.jsonl`, junto al
índice. La app lleva en su carpeta de datos (`app_data_dir()`, en Windows
`%APPDATA%\dev.sens.desktop\`) dos ficheros pequeños:

- `projects.json` — proyectos abiertos alguna vez y el último abierto.
- `profile.json` — el perfil local. El instalador escribirá aquí el nombre.

`sens-agent` no se toca. Todo lo nuevo vive en `sens-app`.

## Backend (Rust, `rust/sens-app/src`)

### `projects.rs`

Funciones puras sobre un directorio base, testeables con un directorio temporal.

```rust
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Registry { pub last: Option<String>, pub projects: Vec<Known> }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Known { pub root: String, pub opened: u64 }

pub fn load(base: &Path) -> Registry
pub fn remember(base: &Path, root: &str) -> Result<(), String>
```

- `load` devuelve `Registry::default()` si el fichero falta o está corrupto; nunca falla.
- `remember` inserta o actualiza `root` con `opened = session::now()`, fija
  `last = root` y escribe el fichero entero (crea `base` si falta). Las rutas se
  comparan tal cual, sin normalizar mayúsculas.

### `profile.rs`

```rust
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Profile { pub name: String }

pub fn load(base: &Path) -> Profile
pub fn save(base: &Path, profile: &Profile) -> Result<(), String>
```

`save` recorta espacios del nombre. `load` nunca falla.

### Comandos nuevos en `main.rs`

| Comando | Firma JS | Devuelve |
| --- | --- | --- |
| `workspaces` | `invoke("workspaces")` | `Workspace[]` |
| `remember` | `invoke("remember", { root })` | `null` |
| `last_project` | `invoke("last_project")` | `string \| null` |
| `profile` | `invoke("profile")` | `{ name }` |
| `save_profile` | `invoke("save_profile", { name })` | `null` |

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Workspace { root: String, name: String, active_at: u64, sessions: Vec<session::Summary> }
```

- `workspaces` lee el registro, descarta proyectos cuya carpeta ya no existe,
  y para cada uno llama a `session::list` y **filtra las sesiones con
  `tasks == 0`**. `name` es el último componente de la ruta. `active_at` es el
  `started_at` de la sesión más reciente o, si no hay ninguna, `opened`. La
  lista sale ordenada por `active_at` descendente. Un proyecto sin sesiones
  sigue apareciendo.
- `last_project` devuelve `last` solo si la carpeta existe.
- La carpeta base se obtiene con `app.path().app_data_dir()`; los comandos
  reciben `AppHandle`.
- Los comandos existentes (`open_session`, `sessions`, `replay`…) no cambian.

## Frontend (`rust/sens-app/ui/index.html`)

### Estructura de la barra

`.rail` pasa a tres filas: cabecera, lista, pie (`auto minmax(0,1fr) auto`).

```
SESIONES                    [+]
▾ coinpla                   [+]
   Añade validación al…   10:33
   Borra lo muerto        ayer
▸ Fichaje
▸ SGT-Portal
────────────────────────────────
(SG) Sofía                   ⌃
```

- **Grupo de proyecto**: una fila de 28 px con chevron (Lucide `chevron-down` /
  `chevron-right`, se intercambia el icono, no se rota), nombre de la carpeta en
  sans 13/450 y `ruta completa` en el `title`. Al pasar el ratón aparece un `+`
  para empezar una sesión en ese proyecto. El grupo del proyecto abierto está
  siempre desplegado; el resto recuerda su estado en `localStorage`
  (`sens.rail.folded`, lista de rutas plegadas, con try/catch).
- **Fila de sesión**: una sola línea de 30 px, sangrada bajo su grupo. Título a
  la izquierda con elipsis; a la derecha la hora en mono 11 px `--ghost`
  (`10:33` hoy, `ayer`, `22 sept` el resto). Paradas y líneas netas pasan al
  `title` de la fila. Activa: fondo `--raise` + la barra de 2 px en `--focus`
  que ya existe. Signal solo ahí.
- **Proyecto sin sesiones**: el grupo desplegado muestra `Sin sesiones.` en la
  clase `.none` existente.
- **Sin ningún proyecto**: la lista muestra `Elige una carpeta.` como hoy.

### Flujo de sesiones

- Una función `enter(root)` reúne lo que hoy hace el botón de carpeta después del
  diálogo (etiqueta, repo, estado, ficheros, limpiar código abierto) y además
  llama a `remember`. La usan el botón de carpeta, el arranque y abrir una
  sesión de otro proyecto.
- **Borrador**: `+`, elegir carpeta y el arranque dejan `current = ""` y el hilo
  con el saludo de siempre. No se llama a `open_session`.
- **Primer envío**: si `current` está vacío, se hace
  `current = await invoke("open_session", { root })` justo antes de `work`. El
  compositor queda habilitado con carpeta aunque no haya sesión.
- **Abrir sesión**: si su proyecto no es el abierto, `enter(root)` y luego
  `load(id)`.
- **Arranque**: `last_project()`; si hay, `enter(root)` en borrador. Después
  `paintRail()`.
- `paintSessions` se sustituye por `paintRail()`, que pinta desde
  `invoke("workspaces")`. Se llama donde hoy se llama a `paintSessions`.

### Pie: perfil y menú

- Botón de 44 px de alto a todo el ancho del pie, separado por `--hair`. Avatar
  de 24 px redondo, fondo `--raise`, iniciales (máx. 2) en sans 11/600 `--dim`;
  sin nombre, el icono Lucide `user` a 16 px. Al lado el nombre (o `Sin nombre`
  en `--ghost`) y a la derecha `chevrons-up-down` a 16 px.
- Abre un menú anclado encima, reutilizando el sistema `.sheet` existente
  (cierre con clic fuera y Escape ya resueltos). Entradas, con icono Lucide a
  16 px y trazo 1.5:
  - `settings` Ajustes
  - `keyboard` Atajos de teclado
  - `info` Acerca de Sens
- Navegación con flechas arriba/abajo, Enter activa, Escape devuelve el foco al
  botón. `role="menu"` / `role="menuitem"`.

### Paneles del menú

Un único componente de diálogo modal (`<dialog>` nativo, radio `--r-sheet`,
fondo `--panel`, borde `--hair-strong`, ancho 420 px, sin sombra) con título y
cuerpo intercambiables.

- **Ajustes**: campo `Nombre` y botón `Guardar` (primario: fondo bone-50, texto
  carbon-950). Guardar llama a `save_profile`, repinta el pie y cierra.
- **Atajos de teclado**: tabla de dos columnas, teclas en mono:
  `Enter` enviar · `Mayús+Enter` salto de línea · `Ctrl+N` sesión nueva ·
  `Ctrl+O` abrir carpeta · `Esc` cerrar. `Enter`, `Mayús+Enter` y `Esc` ya
  existen; `Ctrl+N` y `Ctrl+O` se añaden en este trabajo.
- **Acerca de Sens**: `sens`, versión con `window.__TAURI__.app.getVersion()` y
  `github.com/iiTzSenn/Sens` en mono, seleccionable. Sin abrir el navegador.

## Errores

- Un `invoke` que falla en el pie o en la barra deja la lista anterior y pinta
  una línea `.none` en `--red` con el motivo. Nunca bloquea el chat.
- Un proyecto borrado del disco desaparece de la lista sin aviso.
- `save_profile` fallido muestra el motivo bajo el campo y no cierra el diálogo.

## Pruebas

- Rust (`cargo test -p sens-app`): `remember` inserta, actualiza sin duplicar y
  fija `last`; `load` con fichero ausente y corrupto; perfil ida y vuelta con
  recorte; la agregación de `workspaces` filtra vacías, ordena por actividad y
  descarta carpetas inexistentes (sacar esa lógica a una función pura que
  reciba el registro y la base).
- UI: a mano en la app nativa y en el panel de vista previa con un stub de
  `__TAURI__` que devuelva dos proyectos de ejemplo.

## Identidad

Tokens existentes, Lucide en SVG con trazo 1.5, Signal solo en la sesión activa.
Sin comentarios en ningún fichero. Sens identity tokens preserved.
