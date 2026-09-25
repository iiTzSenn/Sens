# Terminal

Fecha: 2026-09-25 · Ámbito: `rust/sens-app` (`terminal.rs`, `main.rs`),
`rust/sens-agent/src/process.rs`, `ui/src/features/terminal/`, `ui/src/app/`.
Implementado.

## Decisiones

- Una consola de verdad dentro de Sens, como la de Claude Desktop o VS Code: una
  quinta herramienta del panel derecho, *Terminal*, junto a Ficheros, Cambios, Web
  y Segundo plano.
- Es la shell de la persona, no la de Claude: nada de lo que se escribe llega al
  modelo y no lleva las variables de los proveedores (claves de API incluidas).
- Cada terminal abre en la carpeta del proyecto que está a la vista. Si no hay
  proyecto, o la carpeta ya no existe, abre en la carpeta de usuario.
- Varias a la vez, en pestañas con el nombre de su carpeta. Cambiar de proyecto no
  las cierra: un servidor de desarrollo sigue corriendo.
- Cerrar una pestaña termina la shell y todo lo que lanzó. Cerrar Sens, o
  actualizarlo, termina todas.
- Cuando la shell termina sola (`exit`), la pestaña se queda con su salida y una
  línea «El proceso terminó con el código N.»; ya no acepta teclas.
- `Ctrl+Ñ` (y ``Ctrl+` `` en teclados que la tienen) la abre y la cierra, como en
  VS Code. Cerrarla desde dentro devuelve el foco al mensaje.

## Shell

- Windows: `pwsh.exe` si está en el `PATH`, si no `powershell.exe`, con `-NoLogo`.
- Otros sistemas: `$SHELL` (o `/bin/sh`) con `-l` y `TERM=xterm-256color`.
- Siempre `COLORTERM=truecolor`. El resto del entorno es el del usuario, leído de
  nuevo al abrir (en Windows, del registro), así que un programa recién instalado
  ya está en el `PATH`.
- El PTY es `portable-pty` (ConPTY en Windows). En Windows la shell entra en un Job
  Object (`process::Family::of`) para que cerrar la mate con sus hijos.

## Contrato

| Comando | Firma JS | Devuelve / efecto |
| --- | --- | --- |
| `terminal_open` | `invoke("terminal_open", { root, cols, rows })` | `{ id, shell }`; la shell ya corre |
| `terminal_write` | `invoke("terminal_write", { id, data })` | `null`; lo escrito, tal cual |
| `terminal_resize` | `invoke("terminal_resize", { id, cols, rows })` | `null` |
| `terminal_close` | `invoke("terminal_close", { id })` | `null`; termina la shell y lo que lanzó |

Evento `terminal`:

- `{ kind: "out", id, data }`: lo que imprimió, en UTF-8. Un carácter partido
  entre dos lecturas espera a su otra mitad.
- `{ kind: "ended", id, code }`: siempre después de la última salida. `code` es
  `null` si no se pudo leer.

La salida puede llegar antes de que `terminal_open` responda (ConPTY pregunta la
posición del cursor al arrancar y espera la respuesta). La interfaz guarda lo que
llega de un `id` que aún no conoce y lo pinta al registrarlo; xterm.js contesta la
pregunta solo.

## Interfaz

- xterm.js con `@xterm/addon-fit`. Una instancia por terminal, que vive fuera de
  React y se mueve a su hueco: cambiar de pestaña o de herramienta no la pierde.
- Se abre en el DOM la primera vez que su hueco tiene tamaño (el panel entra con
  una animación de anchura) y el foco espera a ese momento.
- Lo que se escribe va a Rust en orden, una escritura cada vez; lo tecleado
  mientras tanto se junta en la siguiente.
- Los cambios de tamaño del PTY esperan 80 ms a que el panel deje de moverse.
- `Ctrl+C` con texto seleccionado lo copia; sin selección es la interrupción de
  siempre. `Ctrl+V` pega. Las demás combinaciones son de la shell.
- Colores de los tokens, en claro y en oscuro, y se repintan al cambiar el
  aspecto: fondo `--panel`, texto `--dim` (la salida de máquina en Alloy), cursor
  `--focus`, ANSI con `--red`, `--green`, `--amber`, `--blue` y tres roles nuevos
  en `tokens.css`: `--ansi-black`, `--ansi-magenta`, `--ansi-cyan`. Signal solo
  aparece en el cursor.
- El menú de herramientas cuenta las terminales vivas.
- En el navegador (`npm run dev -w sens-app-ui`) hay una terminal simulada que
  repite lo que se teclea y termina con `exit`.

## Pruebas

- `terminal.rs`: caracteres partidos, tamaño mínimo, carpeta inexistente, forma
  de los eventos. En vivo, `#[ignore]`: `a_shell_answers_and_ends_when_closed`
  abre la shell de verdad, contesta a ConPTY, ejecuta `echo`, la cierra y espera
  `ended`.
- `features/terminal/terminal.test.tsx`: salida anterior al registro, orden de lo
  escrito, fin de la shell, copiar y pegar, pestañas, cerrar la última, el atajo,
  añadir al mensaje (selección, pantalla, líneas partidas, cercas) y lo que lee
  Claude.

## Añadir al mensaje

- El botón de la cabecera añade al mensaje en curso lo seleccionado, o lo que se ve
  si no hay selección, en un bloque ` ```console `. La cerca es más larga que
  cualquier tirada de comillas invertidas del texto.
- Va detrás de lo ya escrito, separado por una línea en blanco, y el foco vuelve al
  mensaje con el cursor al final. Por eso el texto del mensaje vive en el panel
  (`desk.text`), no en el estado del componente.
- Las líneas que la anchura partió (`isWrapped`) se juntan otra vez.

## Claude lee la terminal

- Sens ofrece a Claude Code una herramienta propia, `read_terminal`, por un servidor
  MCP HTTP mínimo (`mcp.rs`) en `127.0.0.1` con puerto libre y un token de 128 bits.
  Rechaza cualquier petición con cabecera `Origin` (una página web no puede
  hablarle) y sin el token.
- Cada sesión lo recibe con `--mcp-config` y `--allowedTools mcp__sens__read_terminal`:
  solo lee, así que no pide permiso. Arranca la primera vez que se prepara una
  sesión y vive lo que vive Sens. Si no puede abrirse, la sesión sigue sin él.
- Cada sesión lleva su propio token, ligado a sus carpetas (la del proyecto y, si
  la tiene, la de su worktree). Solo lee terminales abiertas dentro de ellas: una
  inyección de prompt en un proyecto no alcanza la terminal de otro. Las rutas se
  comparan sin distinguir barras ni mayúsculas.
- El texto lo da la interfaz, que tiene el búfer real de xterm: Rust emite
  `terminal-read { ask, terminal, lines, within }` y espera como mucho 5 s a
  `terminal_screen(ask, text)`.
- Argumentos: `terminal` (el número de una lectura anterior; si no, la que se ve)
  y `lines` (200 por defecto, entre 1 y 1000). Cuenta desde la última línea con
  contenido: las filas vacías bajo el cursor no gastan líneas.
- La respuesta dice qué terminal es, en qué carpeta, si el proceso terminó y cuáles
  hay abiertas, y después el texto.

| Comando / evento | Firma | Efecto |
| --- | --- | --- |
| `terminal-read` | `{ ask, terminal: number \| null, lines, within: string[] }` | Rust pide la pantalla |
| `terminal_screen` | `invoke("terminal_screen", { ask, text })` | la interfaz contesta |

Protocolo: `initialize` (devuelve la versión que pidió el cliente), `ping`,
`tools/list`, `tools/call`; las notificaciones reciben `202`; `GET` y el resto de
métodos, `405`. Respuestas JSON, sin SSE ni `Mcp-Session-Id`.

## Pruebas del puente

- `mcp.rs`: versión negociada, la herramienta y sus anotaciones, límites de
  `lines`, respuesta tardía como error, notificaciones y métodos desconocidos, y
  por HTTP de verdad: lectura contestada con las carpetas de cada token, tokens
  ajenos o sin alcance `401`, `Origin` `403`.
- En vivo, `#[ignore]`: `claude_code_reads_the_terminal_through_the_bridge` lanza
  Claude Code con Haiku, que lee una pantalla simulada y contesta el puerto que
  aparece en ella.
