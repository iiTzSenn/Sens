# Un worktree por sesión

Fecha: 2026-09-25 · Ámbito: `rust/sens-agent` (`session.rs`, `chat.rs`),
`rust/sens-app` (`worktree.rs`, `git.rs`, `artifacts.rs`, `main.rs`),
`ui/src/features/panes`, `chat`, `composer`, `app/session.ts`. Implementado.

## Decisiones

- Una sesión nueva de un repositorio git puede trabajar en una copia aparte: un
  worktree en `<proyecto>/.sens/worktrees/<8 hex del id>`, en una rama nueva
  `sens/<8 hex>` que sale del `HEAD` de ese momento. Lo que haga Claude no toca la
  carpeta del proyecto hasta que se fusione la rama.
- Se elige antes del primer mensaje, con el chip «Worktree» del compositor. La
  elección se recuerda para las sesiones nuevas siguientes (`sens.isolate`). Una
  sesión que ya empezó no cambia de carpeta: Claude Code guarda su historia por
  carpeta, y `--resume` tiene que encontrarla siempre en la misma.
- `.sens/.gitignore` ignora todo, así que los worktrees no aparecen como cambios
  del proyecto.
- Las sesiones siguen viviendo en `<proyecto>/.sens/sessions`: la barra lateral,
  las capacidades y la confianza son del proyecto. Lo que se trabaja (árbol,
  visor, Cambios, Web, rama, `@`, adjuntos, terminales nuevas) es de la carpeta de
  trabajo de la sesión.
- Borrar la sesión quita el worktree si está limpio; si tiene cambios sin
  confirmar, no se borra nada y se dice por qué. Antes de quitarlo se para el
  Claude Code de la sesión (`Engine::forget`, que tampoco deja escribir nada más
  en su registro) y se cierran las terminales abiertas dentro (Windows no borra
  la carpeta actual de un proceso). La rama se queda, con sus commits. Archivar
  no toca el worktree.
- Lo que se adjunta o se menciona con `@` en el primer mensaje, antes de que el
  worktree exista, es de la carpeta del proyecto: va con ruta absoluta, así Claude
  lee el fichero tal como está (también si no está en git), no la copia del último
  commit.
- El `id` de la sesión se lee una sola vez al enviar: si se abre otra sesión en el
  panel mientras se crea el worktree, el mensaje va a la suya y el worktree no se
  pinta en la otra.
- Cambiar de proyecto olvida el worktree y los comandos del anterior.
- Si crear el worktree falla (sin commits, rama existente…), el mensaje no se
  envía, se explica, y la sesión deja de pedirlo: al reenviar, Claude trabaja en
  la carpeta del proyecto.

## Datos

- `session::Entry::Isolated { at, path, branch, base }`, siempre antes del primer
  `Task`. `session::isolation(root, id)` lee la sesión hasta ese primer `Task`, sin
  recorrerla entera. `session::isolate` se niega si ya hay mensajes.
- `chat::Settings.cwd`: la carpeta donde arranca Claude Code. Forma parte de la
  comparación de ajustes, así que una sesión calentada en el proyecto se relanza
  en su worktree.
- `worktree::work_dir(root, id)`: la carpeta de trabajo, o un error si el worktree
  ya no existe (se dice en vez de lanzar Claude en otro sitio).
- `artifacts::keep_file(root, work, …)`: un adjunto dentro de la carpeta de trabajo
  va con su ruta relativa; uno de fuera se copia a `<proyecto>/.sens/artifacts` y,
  si la sesión trabaja en un worktree, se nombra con ruta absoluta para que Claude
  lo alcance.

## Contrato

| Comando | Firma JS | Devuelve / efecto |
| --- | --- | --- |
| `isolate_session` | `invoke("isolate_session", { root, id })` | `{ path, branch, base }`; si ya lo tenía, el mismo |
| `delete_session` | `invoke("delete_session", { root, id })` | quita antes el worktree limpio; con cambios, error |

`replay` devuelve también la entrada `{ kind: "isolated", path, branch, base }`.

## Interfaz

- `desk.worktree` (la sesión aislada) y `desk.isolate` (lo elegido para la
  sesión nueva). `workOf(pane)` es el worktree o la raíz.
- `project.work` refleja la carpeta de trabajo del panel enfocado. Si cambia sin
  cambiar de proyecto (otra sesión, el primer mensaje, otro panel), se olvidan
  visor, árbol y página, y se leen de nuevo el árbol, los cambios y la rama.
- Enviar: `openSession` → `isolate_session` si se pidió → `chat_send`.
- El chip muestra «worktree» en una sesión aislada; su título dice la rama, de
  dónde salió y la ruta.

## Pruebas

- `session.rs`: se aísla antes del primer mensaje y se recuerda, no después, y
  una sesión archivada sigue sabiendo su carpeta.
- `worktree.rs`, con un repositorio git de verdad: worktree y rama creados, fuera
  del estado del proyecto, idempotente; sin git, sin commits o con la sesión
  empezada, nada; con cambios sin confirmar no se quita ni se para nada, limpio
  sí y la rama sigue.
- `chat_engine.rs`: una sesión olvidada se para y no escribe más. `terminal.rs`
  (en vivo): cerrar una carpeta termina solo las shells abiertas dentro.
- `artifacts.rs`: rutas alcanzables desde el worktree.
- `chat_engine.rs`: Claude Code arranca en la carpeta de la sesión.
- UI: orden aislar → enviar, adjuntos y `@` del primer mensaje, otra sesión
  abierta mientras se crea, fallo y reintento, sin repositorio, sesión guardada,
  y el chip.

## Límites

- Lo que no está en git (`node_modules`, `.env`) no está en el worktree: hay que
  instalar o copiar lo que haga falta allí.
- Fusionar la rama es cosa de la persona (o de pedírselo a Claude).
