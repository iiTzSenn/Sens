# Instalador propio y bienvenida

Fecha: 2026-09-24 · Ámbito: `rust/sens-setup` (nuevo), `rust/sens-app/ui`
(`setup.html`, `src/setup/`, `src/features/welcome/`, `src/shared/stone.ts`),
`rust/sens-app/src` (`welcome.rs`, `profile.rs`, `projects.rs`, `main.rs`),
`rust/sens-agent/src/transcript.rs`, `scripts/app-installer.mjs`,
`.github/workflows/release.yml`.
Sustituye al instalador NSIS de Tauri. `update.rs` no cambia.

## Tarea del usuario

Instalar Sens con un instalador que ya es Sens: su tipografía, su piedra, su
voz. Y la primera vez que abre la app, dejarla lista en un minuto: su nombre,
Claude Code conectado, lo que ya tenía en Claude Code dentro de Sens y un
proyecto abierto.

Acción focal del instalador: «Instalar Sens». De la bienvenida: «Continuar».

## Decisiones

- **Instalador propio, no NSIS.** NSIS pinta diálogos Win32: no llega al
  diseño. `sens-setup` es una app Tauri pequeña cuya ventana es HTML/CSS, así
  que se diseña y se edita como cualquier pantalla de Sens, en el navegador,
  con `npm run dev:setup -w sens-app-ui`.
- **Un solo `.exe` que lleva la app dentro.** Lo que instala NSIS hoy es un
  único `sens-app.exe` de ~7 MB. El instalador lo lleva comprimido con Brotli
  (`include_bytes!`) y lo escribe en disco. Sin descargas durante la
  instalación.
- **Toma el relevo de NSIS sin romper nada.** Misma carpeta, mismas claves de
  registro, mismo acceso directo y mismo `uninstall.exe`: una copia instalada
  con NSIS se actualiza en su sitio y Windows sigue viendo una sola «Sens».
- **Las copias ya instaladas se actualizan solas.** `update.rs` descarga
  `Sens_<v>_x64-setup.exe`, verifica su `.sig` y lo lanza con `/P /UPDATE /R`.
  El instalador nuevo se llama igual, se firma igual y entiende esos
  argumentos.
- **Por usuario, sin UAC.** `%LOCALAPPDATA%\Sens`, `HKCU`. Como hoy.
- **Importar sesiones es adoptarlas.** Una sesión de Sens usa el mismo UUID que
  la de Claude Code (`--session-id` el primer turno, `--resume` después). Sens
  convierte el transcript de Claude Code a su propio registro y, al seguir la
  conversación, Claude Code la retoma con todo su contexto. No se copia ni se
  toca nada de `~/.claude`.
- **Las skills y los MCP de Claude Code no se copian.** El chat de Sens no aísla
  a Claude Code: ya carga `~/.claude/skills`, los plugins activos y los MCP de
  `~/.claude.json` en cada sesión. Copiarlos los cargaría dos veces. La
  bienvenida los enseña como «ya funcionan en Sens».
- **Los MCP de otras apps sí se importan.** Claude Desktop, Cursor, Windsurf y
  VS Code guardan servidores que Claude Code no ve. Se añaden a Capacidades y se
  activan en los proyectos que el usuario trae.
- **La piedra es un render en vivo.** WebGL, sin librerías: la misma piedra del
  icono de la app, con el corte encendido. Sirve al instalador y a la
  bienvenida. Sin WebGL, la marca plana.
- **La bienvenida sale una vez.** También a quien ya usaba Sens: es nueva y trae
  la importación. Se salta con un clic y se vuelve a abrir desde Ajustes.

## Parte 1 · El instalador (`rust/sens-setup`)

### Modos

Un solo binario. El modo sale de los argumentos y de dónde se ejecuta:

| Cómo se lanza | Modo | Ventana |
| --- | --- | --- |
| Doble clic en `Sens_<v>_x64-setup.exe` | `install` | Completa, espera al usuario |
| `… /P /UPDATE /R` (lo lanza `update.rs`) | `update` | Solo progreso; reabre Sens al terminar |
| `… /S` | `install` silencioso | Ninguna |
| `uninstall.exe` (el nombre del propio fichero), o `--uninstall` | `uninstall` | Completa |
| `uninstall.exe /S` | `uninstall` silencioso, sin borrar datos | Ninguna |

`/P` = pasivo (sin preguntas), `/R` = abrir Sens al acabar, `/UPDATE` = no
recrear accesos que el usuario quitó. Son los argumentos del NSIS de Tauri.
`--dir <ruta>` fija la carpeta en `install` (sin él: la instalada, o la de por
defecto).

Si al abrir `install` ya hay una Sens instalada, el modo sigue siendo
`install` pero la portada dice «Actualiza Sens» (versión menor), «Reinstala
Sens» (misma) o avisa de que la instalada es más nueva (mayor) y ofrece
reinstalar esta.

### Qué deja en el sistema

Exactamente lo que dejaba NSIS, para tomar el relevo:

| Qué | Dónde |
| --- | --- |
| App | `<dir>\sens-app.exe` (por defecto `<dir>` = `%LOCALAPPDATA%\Sens`) |
| Desinstalador | `<dir>\uninstall.exe` (copia del propio instalador) |
| Entrada de «Aplicaciones» | `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Sens`: `DisplayName`=`Sens`, `DisplayIcon`=`"<dir>\sens-app.exe"`, `DisplayVersion`, `Publisher`=`sens`, `InstallLocation`=`"<dir>"`, `UninstallString`=`"<dir>\uninstall.exe"`, `QuietUninstallString`=`"<dir>\uninstall.exe" /S`, `MainBinaryName`=`sens-app.exe`, `NoModify`=1, `NoRepair`=1, `EstimatedSize` (KB, DWORD) |
| Carpeta recordada | `HKCU\Software\sens\Sens`, valor por defecto = `<dir>` |
| Menú Inicio | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Sens.lnk` → `sens-app.exe`, carpeta de trabajo `<dir>` |
| Escritorio (opcional) | `%USERPROFILE%\Desktop\Sens.lnk` (la carpeta real del escritorio, `FOLDERID_Desktop`) |

Los datos de la app (`%APPDATA%\dev.sens.desktop`, `%LOCALAPPDATA%\dev.sens.desktop`)
y las sesiones (`.sens/` de cada proyecto) no los toca la instalación.

### Motor

Módulos de `rust/sens-setup/src`:

- `layout.rs` — `Layout { dir, uninstall_key, remembered_key, start_menu, desktop }`
  con las rutas de la tabla. `Layout::for_user()` usa las reales; las pruebas
  construyen uno con carpetas temporales y claves bajo
  `HKCU\Software\SensSetupTest\<nombre>`.
- `payload.rs` — la app comprimida. `build.rs` lee `SENS_PAYLOAD` (ruta al
  fichero que prepara `scripts/app-installer.mjs`); si está, activa
  `cfg(payload)` y lo embebe. Formato: 8 bytes con el tamaño original (u64 LE)
  y el flujo Brotli. Sin `SENS_PAYLOAD` la build es **demo**: recorre los pasos
  con pausas y no escribe nada. `build.rs` también expone la versión de
  `../sens-app/tauri.conf.json` como `SENS_VERSION`.
- `install.rs` — los pasos, cada uno con su línea de registro:
  1. **Comprobar**: carpeta escribible y espacio libre (`GetDiskFreeSpaceExW`).
  2. **Cerrar Sens** si está abierta en `<dir>`: abrir `sens-app.exe` para
     escribir falla con violación de uso compartido mientras corre. En `update`
     espera hasta 30 s (Sens se cierra sola tras lanzar el instalador); en
     `install` el evento `running` lo pregunta a la interfaz.
  3. **Descomprimir** en `<dir>\sens-app.exe.new`, informando de los bytes, y
     comprobar que mide lo que dice la cabecera.
  4. **Cambiar**: `sens-app.exe` → `sens-app.exe.old`, `.new` → `sens-app.exe`,
     borrar `.old` (si no se puede, queda y se borra en la siguiente).
  5. **Desinstalador**: copiar el propio `.exe` a `<dir>\uninstall.exe`, salvo
     si ya se ejecuta desde ahí.
  6. **Registrar** las dos claves.
  7. **Accesos**: menú Inicio (siempre que el usuario no lo quite) y escritorio
     si lo pidió. `IShellLinkW` + `IPersistFile`. En `/UPDATE` solo se rehacen
     los que ya existían.
  Si falla o se cancela antes del paso 4, se borra `.new` y la instalación
  anterior queda intacta. Después del 4 ya no se cancela.
- `uninstall.rs` — si se ejecuta desde `<dir>`, se copia a
  `%TEMP%\sens-uninstall-<pid>.exe`, se relanza con `--uninstall --dir <dir>` y
  sale: así puede borrar su propio `uninstall.exe`. Pasos: cerrar Sens (igual
  que arriba), quitar accesos y claves, y de `<dir>` solo lo que puso el
  instalador (`sens-app.exe`, `.new`, `.old`, `uninstall.exe`); la carpeta se
  borra si queda vacía, nunca entera. Con «borrar mis datos», también las dos
  carpetas `dev.sens.desktop`. Al acabar, un `cmd` oculto espera dos
  segundos y borra la copia temporal.
- `running.rs` — encontrar la Sens abierta por la ruta de su imagen
  (`EnumWindows` + `QueryFullProcessImageNameW`), pedirle que cierre
  (`WM_CLOSE`: Sens apaga su motor y sus `claude`) y, solo si el usuario lo
  pide, forzarla (`TerminateProcess`).
- `main.rs` — antes de abrir ninguna ventana comprueba WebView2 (la clave
  `EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`, valor `pv`, en
  HKLM y HKCU). Si falta, un `MessageBoxW` lo explica y abre la página de
  descarga de Microsoft; el instalador sale. El WebView del instalador guarda
  sus datos en una carpeta temporal que se borra al salir, para no dejar
  `%LOCALAPPDATA%\dev.sens.setup` detrás.
- Registro en `%TEMP%\sens-setup.log`: cada línea del progreso, con hora.

### Contrato

| Comando | Firma JS | Devuelve / efecto |
| --- | --- | --- |
| `setup_state` | `invoke("setup_state")` | `SetupState` (abajo) |
| `setup_dir` | `invoke("setup_dir", { dir })` | `{ free: number \| null, problem: string }`; `problem` vacío si se puede instalar ahí |
| `setup_install` | `invoke("setup_install", { choice: { dir, desktop, startMenu } })` | resuelve al terminar; rechaza con el motivo (ya revertido) |
| `setup_uninstall` | `invoke("setup_uninstall", { removeData })` | resuelve al terminar |
| `setup_cancel` | `invoke("setup_cancel")` | pide parar; `setup_install` rechaza con `"cancelado"` |
| `setup_close_app` | `invoke("setup_close_app", { force })` | `true` si Sens ya no está abierta |
| `setup_launch` | `invoke("setup_launch")` | abre la Sens instalada, desligada del instalador |
| `setup_quit` | `invoke("setup_quit")` | sale, limpiando la carpeta temporal del WebView |

```ts
interface SetupState {
  mode: "install" | "update" | "uninstall";
  version: string;                                  // la que trae este instalador
  installed: { version: string; dir: string } | null;
  dir: string;                                      // la instalada, o la de por defecto
  size: number;                                     // bytes de la app ya instalada
  free: number | null;
  passive: boolean;                                 // /P o /S
  relaunch: boolean;                                // /R
  desktop: boolean;                                 // ya hay acceso en el escritorio
  demo: boolean;
}
```

Evento `"setup"`: `{ step, progress, line }` con `step` =
`check | close | extract | swap | register | shortcuts | done | remove`,
`progress` de 0 a 1 y `line` la frase para el registro. Evento
`"setup-running"`: `{ running: true }` cuando Sens está abierta y hace falta
que la interfaz pregunte.

### Interfaz (`ui/setup.html`, `ui/src/setup/`)

Ventana de 880 × 520, sin marco del sistema (Windows 11 pone esquinas y sombra),
fondo `carbon-950`, no redimensionable. Aparece cuando la página ya pintó, sin
destello blanco. Controles: minimizar y cerrar (Lucide, 1.5).

1. **Portada** — izquierda: wordmark `sens`; «Instala Sens.» (display);
   «Todo empieza con claridad.»; botón Signal «Instalar Sens →»; enlace
   «Personalizar instalación»; pie «Sens para Windows · v0.17.0». Derecha: la
   piedra en reposo. `Enter` instala.
2. **Personalizar** — sustituye la columna izquierda (la piedra no se mueve):
   carpeta (mono) con «Cambiar…», «Necesita 7 MB · libres 120 GB»; casillas
   «Acceso directo en el escritorio» y «Añadir al menú Inicio». «Instalar Sens →»
   y «Volver». Si la carpeta elegida no se llama `Sens`, se le añade `Sens`:
   el desinstalador solo borra sus ficheros y la carpeta si queda vacía. Con una
   Sens ya instalada, la carpeta no se cambia.
3. **Instalando** — la piedra pasa a la izquierda, más pequeña, en estado
   *scan* (una luz recorre el corte). «Preparando Sens», barra Signal con el
   porcentaje (cifras tabulares), la frase del paso, las cuatro últimas líneas
   del registro en mono (`›`), y al pie «Ver detalles» (despliega el registro
   entero) y «Cancelar». La barra se mueve con suavidad hacia el valor real y
   cada paso se ve al menos 280 ms: son 7 MB y sin eso sería un parpadeo.
4. **Sens está abierta** — si hace falta cerrarla: «Sens está abierta. Ciérrala
   para seguir; las sesiones que estén trabajando se detendrán.» «Cerrar Sens» y,
   si no cierra en 10 s, «Forzar el cierre».
5. **Listo** — la piedra hace *done* (un brillo breve y quietud). «Sens está
   lista.» «En un minuto la dejamos a tu gusto.» «Abrir Sens →» (`Enter`) y
   «Cerrar». Sin casilla de «abrir al terminar»: el botón ya lo es.
6. **Error** — el motivo en `danger` con icono, «Reintentar» y «Copiar
   registro».

`update`: pasa directo a *Instalando* con «Actualizando Sens» y «0.16.0 →
0.17.0»; al acabar abre Sens (`/R`) y sale solo.

`uninstall`: portada con «Desinstalar Sens.», «Se quita la aplicación. Tus
proyectos y sus sesiones no se tocan.», casilla «Borrar también mis ajustes,
skills y plugins de Sens» (desmarcada), botón «Desinstalar» (borde `danger`, no
Signal) y «Cancelar». La piedra con el corte apagado. Después, progreso y
«Sens se ha desinstalado.»

Voz: frases cortas, sin exclamaciones. El registro describe trabajo real:
«Comprobando espacio · 120 GB libres», «Descomprimiendo sens-app.exe ·
7,3 MB», «Registrando Sens en Windows», «Acceso directo en el menú Inicio»,
«Listo en 1,9 s».

En desarrollo, `src/setup/mock.ts` simula el motor y `?mode=update`,
`?mode=uninstall`, `?installed=0.16.0`, `?fail=extract` y `?running=1` enseñan
cada caso.

Estilos: `src/shared/tokens.css` (los tokens y la fuente, antes al principio de
`styles.css`) y `src/shared/stage.css` (titulares, botón Signal grande,
casillas, barra de ventana) los comparten el instalador y la bienvenida, bajo la
clase `.stage`; los reinicios de botón van con `:where()` para no pisar los
componentes de la app que se muestran dentro.

### Build y firma

`scripts/app-installer.mjs` (mismos requisitos de firma que hoy):

1. `tauri build --no-bundle` en `rust/sens-app`.
2. Firma Authenticode de `sens-app.exe` (la app instalada va firmada).
3. Empaqueta: tamaño + Brotli (calidad 11, ventana 24) en
   `rust/sens-setup/target/payload/sens-app.br`.
4. `tauri build --no-bundle` en `rust/sens-setup` con `SENS_PAYLOAD`
   apuntando ahí (su `beforeBuildCommand` construye `ui/dist-setup`).
5. Copia el resultado a `rust/sens-setup/target/installer/Sens_<v>_x64-setup.exe`.
6. Firma Authenticode del instalador y comprobación de firma y sello, como hoy.
7. `.sig` minisign con `tauri signer sign` y comprobación de la clave, como hoy.

`signtool` se busca en el Windows SDK; `SENS_SIGN_COMMAND` sigue valiendo para
ambas firmas. `release.yml` sube `rust/sens-setup/target/installer/*`.

## Parte 2 · La piedra (`ui/src/shared/stone.ts`)

`mountStone(canvas, { state }) → { set(state), destroy() }`. Sin dependencias.

- Un fragment shader con *raymarching*: un ovoide inclinado como el del icono,
  con un surco en S de lado a lado que lo parte en dos masas. Material mate, de
  grano fino (ruido en la normal) y brillo de terciopelo en el contorno. Luz
  principal arriba a la izquierda, contraluz suave a la derecha.
- El fondo del surco emite `signal-500`; su halo no pasa de 1,5 veces el ancho
  del corte en reposo. Un suelo invisible recibe la sombra de la piedra y un
  charco tenue de Signal bajo el corte, y se funde a transparente: el lienzo va
  sobre cualquier fondo.
- Estados (identidad §8): `idle` (el corte respira en 5 s, amplitud baja),
  `scan` (una luz recorre el corte cada 1,1 s), `focus` (el corte se enciende de
  un extremo al otro una vez), `done` (un brillo de 560 ms y quietud), `rest`
  (corte casi apagado).
- Solo pinta mientras algo cambia; en `idle` a 30 fps; nada con la ventana
  oculta. Si los primeros fotogramas tardan más de 40 ms, pinta un fotograma por
  estado y deja de animar. Con `prefers-reduced-motion`, sin movimiento.
- Sin WebGL: la marca plana (`markSvg`) en su lugar.

## Parte 3 · La bienvenida en la app

### Cuándo sale

`Profile` gana `welcomed: bool` (falta → `false`). Al cargar el perfil, si es
`false`, la bienvenida cubre la ventana entera; la app arranca debajo como
siempre. Ajustes › General gana el bloque «Bienvenida» con «Volver a verla».

### Pasos

Composición del instalador: texto a la izquierda, la piedra a la derecha, la
barra de ventana arriba (arrastrar, minimizar, cerrar). Cinco marcas de paso
bajo el wordmark. `Enter` avanza, `Esc` no cierra nada. «Saltar la bienvenida»
siempre visible abajo a la izquierda.

1. **Hola** — la piedra hace *focus*. «Te damos la bienvenida a Sens.»
   «Entiende más. Lee menos.» «Te dejamos lista la app en un minuto: tu nombre,
   Claude Code y lo que ya tienes.» «Empezar →».
2. **Nombre** — «¿Cómo te llamas?» Un campo grande, sin caja, con una línea
   debajo. «Sale en la barra lateral. Puedes dejarlo en blanco.» Al lado, el
   avatar con las iniciales, que se escribe a la vez. «Continuar» / «Ahora no».
3. **Claude Code** — «Sens usa Claude Code.» («usa», nunca «trabaja con» ni
   «oficial»: no se da a entender ninguna relación con Anthropic.) Una superficie destacada
   (tinte Signal) con su estado: sin instalar («Instalar Claude Code · 230 MB,
   desde Anthropic», con progreso), sin sesión (las tres formas de entrar de
   Ajustes › Proveedores), o conectado («Conectado · Suscripción Max ·
   correo», con un check). Reutiliza el almacén de Ajustes. «Continuar» o
   «Hacerlo más tarde».
4. **Lo que ya tienes** — «Trae lo que ya tienes.» Mientras busca, la piedra en
   *scan* y la línea «Buscando en `~/.claude`…». Después, en este orden:
   - **Sesiones de Claude Code** — «212 sesiones en 34 proyectos». Una fila por
     proyecto: casilla, nombre, ruta en mono, sesiones, última actividad. Vienen
     marcados los sugeridos; los que no existen salen desactivados («la carpeta
     ya no existe»). «Marcar todos» / «Ninguno».
   - **De Claude Code, ya activo** — «15 skills, 2 servidores MCP y 3 plugins ya
     funcionan en Sens: Claude Code los carga en cada sesión.» Se despliega con
     los nombres. Sin casillas.
   - **Servidores MCP de otras apps** — una fila por servidor con casilla, la
     app de origen y el comando o la URL en mono. Los que no se pueden traer,
     desactivados con el motivo. «Se añaden a Capacidades y se activan en los
     proyectos que traes.»
   Si no hay nada: «No hay nada que traer. Empiezas de cero.» «Importar» /
   «Continuar sin importar».
5. **Primer proyecto** — «¿Con qué proyecto empezamos?» Los cinco proyectos más
   recientes de los que trae (o de los que Sens ya conoce), como filas
   seleccionables, y «Elegir otra carpeta…». «Continuar».
6. **Preparando** — la piedra en *scan*; una lista que se va marcando: «Nombre
   guardado», «212 sesiones importadas en 34 proyectos», «3 servidores MCP
   añadidos». Los fallos salen en su línea, con `warning`, sin parar el resto.
   Al terminar la piedra hace *done* y el título pasa a «Todo listo, Sofía.».
   En lugar de la lista queda **tu Sens**: la superficie destacada del paso, con
   el avatar, el nombre, la cuenta de Claude Code y lo que trajo en cifras
   («212 sesiones · 34 proyectos · 3 MCP»). Debajo, tres atajos en teclas
   (`Ctrl` `N`, `Ctrl` `O`, `Ctrl` `B`) y «Abrir Sens →», que cierra la
   bienvenida y abre una sesión nueva en el proyecto elegido.

Ideas tomadas: importar antes de configurar y enseñar el plan antes de
escribir (Hermes, el importador de Codex), el atajo en teclas grandes
(Linear, Raycast) y la tarjeta final (Arc).

Transiciones: la columna de texto se desvanece y entra 8 px desde la derecha en
200 ms; la piedra no se mueve entre pasos. Sin rebotes.

### Backend

`rust/sens-agent/src/transcript.rs` convierte un transcript de Claude Code en
entradas de Sens:

- `read(path) -> Option<Transcript { id, root, entries }>`; `id` es el nombre
  del fichero, `root` el primer `cwd`.
- Se ignoran las líneas con `isSidechain`, `isMeta`, `isCompactSummary` o
  `isVisibleInTranscriptOnly`, y los tipos que no son `user` ni `assistant`
  salvo los títulos.
- Un `user` cuyo contenido es texto de la persona (cadena o bloques `text`,
  sin `origin.kind` = `task-notification`) abre un turno: `Task { at, text }`.
  `<command-name>/x</command-name><command-args>y</command-args>` se escribe
  `/x y`; `<local-command-stdout>` se ignora. Las imágenes no se traen.
- El primer `assistant` de cada turno añade `Started { model }` (de
  `message.model`): es lo que hace que Sens use `--resume`.
- `assistant` y `user` con `tool_result` pasan por `chat::translate`, tras
  renombrar `toolUseResult` a `tool_use_result`. Solo los eventos duraderos.
- Antes de cada turno nuevo y al final se cierra el anterior con
  `Finished { ok: true, millis }` (del primer al último `timestamp` del turno).
- `at` sale del `timestamp` RFC 3339 de cada línea.
- Título: el último `custom-title` (`Namer::User`), si no el último `ai-title`
  (`Namer::Ai`), si no el último `agent-name` (`Namer::Ai`).
- `adopt(path) -> Result<Adopted, String>` escribe
  `<root>/.sens/sessions/<id>.jsonl` si no existe ni está archivada; si existe,
  `Adopted::Already`. Un transcript sin ningún turno no se adopta, y si la
  carpeta del proyecto ya no existe no se crea.
- Casos que aparecieron con los transcripts reales: un turno interrumpido antes
  de ninguna respuesta recibe igualmente `Started { model: "" }` (si no, Sens
  arrancaría con `--session-id` una sesión que Claude Code ya tiene); un
  mensaje solo con imágenes abre turno con el texto «[imagen]»; los marcadores
  `[Request interrupted by user…` y los `<local-command-…>` no abren turno; el
  modelo `<synthetic>` cuenta como vacío.
- `chat::translate` se parte en `translate(line)` e `interpret(&Value)` para
  no parsear dos veces cada línea.

`rust/sens-app/src/welcome.rs`:

- `scan(base) -> Found`. Busca en la carpeta de Claude Code (`CLAUDE_CONFIG_DIR`
  o `~/.claude`, la misma función que `served.rs`):
  - `projects/*/*.jsonl` (sin entrar en subcarpetas: ahí van los subagentes).
    De cada fichero lee líneas hasta el primer `cwd`. Agrupa por `cwd`; cuenta
    las que ya están en Sens. Descarta los `cwd` que son la carpeta de la app
    instalada o la de datos de Sens (ahí caen las consultas de modelos).
    `suggested` = existe, tiene `.git` o `.sens`, y actividad en los últimos 60
    días.
  - `skills/*/SKILL.md` → nombres; `~/.claude.json` → claves de `mcpServers`;
    `settings.json` → `enabledPlugins` a `true`.
  - Otras apps:
    - Claude Desktop: `%APPDATA%\Claude\claude_desktop_config.json` y, en su
      versión MSIX, `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`
      (`mcpServers`). Un mismo servidor en las dos sale una vez.
    - Cursor: `~/.cursor/mcp.json` (`mcpServers`).
    - Windsurf: `~/.codeium/windsurf/mcp_config.json` (`mcpServers`; la URL de
      los remotos va en `serverUrl`).
    - VS Code: `%APPDATA%\Code\User\mcp.json` (`servers`).
    - Codex: `~/.codex/config.toml` (`[mcp_servers.<nombre>]`).
    `blocked` con el motivo si el nombre ya está en Sens o en Claude Code, si no
    es un nombre válido, si usa variables `${input:…}` de VS Code o si su
    transporte no es `stdio`, `http` ni `sse`.
  - Los valores de `env` y `headers` se copian tal cual: pasan de un fichero de
    configuración del usuario a otro del mismo usuario, y sin ellos el servidor
    no arranca. La interfaz enseña qué variables lleva cada uno.
- `adopt(base, roots, report) -> Adopted`: adopta cada transcript de esos
  proyectos, informa de cada uno y registra cada proyecto con
  `projects::register` (lo añade sin tocar `last`).
- `import_servers(base, ids, roots) -> Imported`: con `capabilities::add_server`
  o `add_remote` (sin proyecto) y después `set_server` en cada `root`.

`profile::set_welcomed(base, bool)`.

`scan`, `adopt` e `import_servers` reciben un `&Places` (carpeta de Claude Code,
`home`, `%APPDATA%`, `%LOCALAPPDATA%`, carpeta de la app) para que las pruebas
trabajen en una carpeta temporal. Los `cwd` se agrupan sin distinguir la
mayúscula de la unidad (`c:` y `C:`). Las configuraciones JSON admiten
comentarios, comas finales y BOM (el `mcp.json` de VS Code los permite). Los
valores de `env` y `headers` nunca llegan a la interfaz: solo sus nombres.

En desarrollo, la app enseña la bienvenida con `?welcome` en la URL.

### Contrato

| Comando | Firma JS | Devuelve / efecto |
| --- | --- | --- |
| `welcome_scan` | `invoke("welcome_scan")` | `Found` |
| `welcome_adopt` | `invoke("welcome_adopt", { roots })` | `Adopted`; evento `"welcome"` `{ done, total }` |
| `welcome_servers` | `invoke("welcome_servers", { ids, roots })` | `Imported` |
| `set_welcomed` | `invoke("set_welcomed", { on })` | guarda `welcomed` |

```ts
interface Found {
  claude: string;
  projects: FoundProject[];
  skills: string[];
  servers: string[];
  plugins: string[];
  foreign: ForeignServer[];
}
interface FoundProject {
  root: string; name: string; exists: boolean;
  sessions: number; already: number; last: number; suggested: boolean;
}
interface ForeignServer {
  id: string;                    // "<source>:<name>"
  source: "claude-desktop" | "cursor" | "windsurf" | "vscode" | "codex";
  app: string;                   // "Claude Desktop"
  name: string; kind: "stdio" | "http" | "sse";
  command: string; args: string[]; url: string; envKeys: string[];
  blocked: string;
}
interface Adopted { sessions: number; projects: number; skipped: { root: string; reason: string }[] }
interface Imported { added: string[]; skipped: { name: string; reason: string }[] }
```

## Errores

| Situación | Qué pasa |
| --- | --- |
| Sin WebView2 | `MessageBoxW` con el enlace de Microsoft; el instalador sale sin tocar nada |
| Carpeta sin permiso o sin espacio | `setup_dir` lo dice en Personalizar; «Instalar» desactivado |
| Sens abierta y no cierra | Pantalla 4; «Forzar el cierre» tras 10 s |
| Falla antes de cambiar el `.exe` | Se borra `.new`; la versión anterior sigue; pantalla de error |
| Falla después (registro, accesos) | La app ya está; el error lo dice y «Reintentar» repite solo lo que falta |
| Un proyecto no admite `.sens` (p. ej. `Program Files`) | Se salta con su motivo en `skipped`; los demás siguen |
| Un transcript dañado | Se salta la línea; si no queda ningún turno, la sesión no se adopta |

## Fuera de alcance

- macOS y Linux. ARM64 de Windows.
- Que una sesión importada siga los cambios que se hagan después en la
  terminal: se importa tal como está.
- Enseñar en Capacidades lo que Claude Code carga por su cuenta.
- Instalar para todos los usuarios de la máquina.

## Pruebas

- `sens-setup`: pasos de instalación y desinstalación sobre un `Layout` de
  prueba (carpeta temporal, claves bajo `HKCU\Software\SensSetupTest`), la
  cabecera del payload, el reparto de argumentos a modos, la vuelta atrás si
  falla antes de cambiar.
- `sens-agent`: `transcript.rs` con fixtures: turnos, herramientas y sus
  resultados, títulos por prioridad, comandos, notificaciones y sidechains
  ignorados, `Started` en cada turno, `has_begun` verdadero tras adoptar.
- `sens-app`: `welcome.rs` con una carpeta de Claude Code falsa: agrupación por
  `cwd`, `already`, `suggested`, descarte de las carpetas de Sens, cada formato
  de MCP ajeno y cada motivo de `blocked`.
- UI: la bienvenida recorre los pasos con el IPC simulado; el instalador, con
  `mock.ts`, en cada modo.
