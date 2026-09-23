# Capacidades v3: mercado de plugins, skills y conectores

Fecha: 2026-09-23 · Ámbito: `rust/sens-app` (Rust + `ui/index.html`), `rust/sens-agent`
(`chat.rs`, entorno del proceso). Amplía `2026-09-23-sens-app-capabilities-v2-design.md`;
su decisión «Sin catálogo» queda sustituida por esta.

## Tarea del usuario

Encontrar una skill, un plugin o un conector MCP que necesita, ver todo lo que trae
(sus `.md`, sus componentes, lo que ejecuta) y decidir instalarlo, sin salir de Sens.
Lo instalado se sigue activando por proyecto.

## Decisiones

- **Sens instala por su cuenta** (enfoque A). Descarga fijada al commit, carpeta de
  datos de Sens, `--plugin-dir` por plugin activo. No toca la configuración global
  de Claude Code salvo lo que exija el inicio de sesión OAuth (ver más abajo).
- **Fuentes**: Anthropic oficial, comunidad revisada por Anthropic y skills.sh.
  Fuera: registro abierto de MCP, Docker, Smithery, Glama.
- **Skills de documentos de Anthropic** (`docx`, `pdf`, `pptx`, `xlsx`, licencia
  propietaria): ocultas en todas las fuentes.
- **Conectores con OAuth**: se conectan desde Sens con `claude mcp login`, si la
  prueba previa confirma que el token se reutiliza. Si no, se ven con «Requiere
  iniciar sesión» y no se pueden instalar.

## Fuentes (verificadas el 2026-09-23)

| Id | Origen | Qué da | Etiqueta |
| --- | --- | --- | --- |
| `official` | `anthropics/claude-plugins-official` · `.claude-plugin/marketplace.json` | 311 plugins | `anthropic` si `author.name == "Anthropic"` y origen `./plugins/*`; si no `partner` |
| `knowledge-work` | `anthropics/knowledge-work-plugins` | 120 plugins | `anthropic` |
| `financial-services` | `anthropics/financial-services-plugins` | 19 plugins | `anthropic` |
| `life-sciences` | `anthropics/life-sciences` | 21 plugins | `anthropic` |
| `community` | `anthropics/claude-plugins-community` | 2.282 plugins, fijados a sha | `community` |
| `skills` | `anthropics/skills` · `skills/<n>/SKILL.md` | 15 skills (19 menos 4) | `anthropic` |
| `connectors` | `https://api.anthropic.com/mcp-registry/v0/servers?visibility=commercial&limit=100` + `cursor` | 327 conectores remotos, `toolNames`, `isAuthless` | `anthropic` |
| `skills.sh` | `GET https://skills.sh/api/search?q=<≥2>&limit=50` y `GET /api/download/{owner}/{repo}/{slug}` | skills con `installs` | `skills.sh` (`anthropic` si `source == "anthropics/skills"`) |

- El sha de `HEAD` de cada repo se lee sin cuota de API con
  `GET https://github.com/<o>/<r>.git/info/refs?service=git-upload-pack` (primera
  línea `<sha> HEAD`). El `marketplace.json` se baja de
  `raw.githubusercontent.com/<o>/<r>/<sha>/…`, nunca de `HEAD` (caché de 5 min).
- El endpoint de conectores y el de skills.sh no están documentados: si cambian de
  forma o fallan, su fuente sale como error y las demás siguen.
- `skills`: las rutas salen de la unión de los arrays `skills` de los plugins de su
  `marketplace.json`; nombre y descripción, de la cabecera de cada `SKILL.md` bajado
  de `raw` al sha del catálogo.
- Filtro de licencia: `anthropics/skills` → `docx|pdf|pptx|xlsx`; el plugin
  `document-skills`; resultados de skills.sh con id `anthropics/skills/{docx,pdf,pptx,xlsx}`.

## Backend

### Módulos

- `market.rs` — fuentes, normalización a `Listing`, caché de catálogos, búsqueda en
  skills.sh, filtro de licencia, detalle de una ficha.
- `snapshot.rs` — resolver el origen de una ficha a `(repo, sha, subcarpeta)`,
  descargar el tarball de codeload, extraer con seguridad, listar y leer ficheros.
- `capabilities.rs` — lo instalado y su activación: gana plugins y conectores
  remotos. `launch()` añade un `--plugin-dir` por plugin activo y devuelve también
  el entorno para el proceso.
- `sens-agent/chat.rs` — `Settings` gana `env` (host-only, `#[serde(skip)]`) que se
  aplica al lanzar `claude`; un cambio de `env` reinicia el proceso como hoy `extra`.

Red: `ureq` con TLS nativo de Windows; `flate2` + `tar` para el tarball. Todo por
Rust: la UI nunca abre conexiones hacia fuera y la CSP no cambia.

### Almacenamiento (carpeta de datos de la app)

```
market/catalogs/<fuente>.json      ficha normalizada + fetchedAt + sha
market/repos/<o>-<r>-<sha>[-<hash de ruta>]/   copia extraída, compartida por detalle e instalación
plugins/<nombre>/                  plugin instalado (con .claude-plugin/plugin.json)
skills/<nombre>/                   como ahora
mcp.json                           servidores; nuevo tipo remoto
plugin-env.json                    { "<plugin>": { "VAR": "valor" } }, nunca vuelve a la UI
market.json                        { "<tipo>:<nombre>": { listing, sha, version, installedAt } }
capabilities.json                  proyectos → { skills, servers, plugins }
```

- Los catálogos se refrescan si tienen más de 24 h o al pedirlo. Sin red se sirve la
  última copia con su `fetchedAt`.
- `market/repos/` se poda como `agent/`: copias sin usar en 7 días.
- Topes de descarga: 50 MB comprimido, 2.000 ficheros, 100 MB extraído. Se rechazan
  entradas con `..`, rutas absolutas, enlaces simbólicos y duros. Extracción en
  carpeta temporal y `rename` al final; un fallo no deja restos.

### Resolver el origen de un plugin

| `source` | Repo y sha | Subcarpeta |
| --- | --- | --- |
| `"./ruta"` | repo del catálogo al sha del catálogo | `ruta` |
| `{source:"url", url, sha, path?}` | `url` (solo `github.com`) al `sha` | `path` o raíz |
| `{source:"git-subdir", url, path, ref?, sha?}` | `url` o `dueño/repo`, al `sha` (o `ref`) | `path` |
| `{source:"github", repo, ref?, sha?}` | `repo` al `sha` (o `ref`, o `HEAD`) | raíz |

Skills: las de `skills` son la subcarpeta `skills/<n>` de `anthropics/skills` al sha
del catálogo; las de skills.sh salen de su endpoint de descarga
(`{ files: [{ path, contents }] }`) y se escriben en `market/repos/skills-sh-<hash>/`
con las mismas comprobaciones que un tarball. Al instalar van a `skills/<nombre>/`
por el mismo camino que `import_skill`, así que una skill cuyo `name` no cumple la
regla actual (minúsculas, cifras y guiones) no se instala y se dice por qué.

Otros tipos (`npm`, `archive`, `command`) o hosts que no sean `github.com`: la ficha
se lista con «No se puede instalar desde Sens» y enlace a su página.

`strict:false`: la ficha es la definición entera. Sens escribe
`.claude-plugin/plugin.json` con `name`, `description`, `version` y los campos de
componentes de la ficha (`skills`, `commands`, `agents`, `hooks`, `mcpServers`,
`lspServers`). Si la carpeta ya trae un `plugin.json` con componentes, se rechaza
(Claude Code tampoco lo cargaría).

### Tipos

```rust
struct Listing {
    id: String,             // "<fuente>:<nombre>", p. ej. "official:code-review", "skills.sh:vercel-labs/json-render/react-pdf"
    kind: Kind,             // plugin | skill | connector
    name: String,
    title: String,          // displayName / title, o name
    description: String,
    author: String,
    badge: Badge,           // anthropic | partner | community | skillsSh
    source: String,         // id de la fuente
    category: String,
    version: String,
    homepage: String,
    installs: Option<u64>,  // skills.sh
    login: bool,            // conector que pide OAuth
    tools: Vec<String>,     // conectores
    installable: bool,      // false: origen no soportado o conector OAuth sin prueba superada
}

struct Detail {
    listing: Listing,
    readme: String,         // README.md o SKILL.md; en conectores, la descripción
    license: String,        // nombre si se reconoce, si no la primera línea de LICENSE*
    files: Vec<FileRow>,    // { path, size }
    parts: Parts,           // skills, commands, agents: [{ name, path, description }]
                            // hooks: [{ event, command }], servers: [{ name, launch }], lsp: [names], bin: [paths]
    needs: Vec<Need>,       // { name, description, secret, required, default }
    installed: Option<Installed>, // { version, sha, update: bool }
}
```

`needs` sale de `${VAR}` / `${VAR:-x}` en `command`, `args`, `env`, `url` y `headers`
de los servidores del plugin (salvo `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`,
`CLAUDE_PROJECT_DIR`; con `:-x` no es obligatoria), y en conectores de `headers[]` y
`variables` de `remotes`.

### Contrato

| Comando | Firma JS | Devuelve / efecto |
| --- | --- | --- |
| `market` | `invoke("market", { refresh })` | `{ listings: Listing[], sources: [{ id, label, fetchedAt, error }] }` |
| `market_search` | `invoke("market_search", { query })` | `Listing[]` de skills.sh; `[]` con menos de 2 letras |
| `market_detail` | `invoke("market_detail", { id })` | `Detail`; descarga la copia si falta |
| `market_file` | `invoke("market_file", { id, path })` | texto del fichero (hasta 512 KB; binarios, error) |
| `market_install` | `invoke("market_install", { root, id, values })` | `string` nombre instalado; lo activa en `root` si no está vacío |
| `market_update` | `invoke("market_update", { id })` | `null`; reinstala al sha nuevo conservando activación y valores |
| `capabilities` | sin cambios de firma | gana `plugins: [{ name, description, version, badge, enabled, update }]`; `servers[]` gana `url` y `kind` (`stdio`/`http`/`sse`) |
| `set_plugin` | `invoke("set_plugin", { root, name, enabled })` | `null` |
| `remove_plugin` | `invoke("remove_plugin", { name })` | `null`; lo quita de todos los proyectos y borra sus valores |
| `connect_server` | `invoke("connect_server", { name })` | `null`; abre la ventana de inicio de sesión (solo tras la prueba) |

Errores en castellano, como el resto: «ya tienes un plugin llamado X de <fuente>»,
«la descarga pasa de 50 MB», «skills.sh no responde ahora», «este origen no se
puede instalar desde Sens».

### Conectores

- Se guardan en `mcp.json` con `kind: "http" | "sse"`, `url` y `headers`. El nombre
  es el `title` en minúsculas con guiones; si choca, error.
- `streamable-http` se escribe como `http` en la config que recibe Claude Code.
- Los valores de `headers` y `variables` se piden al instalar; los secretos no
  vuelven a la UI.

### Prueba de OAuth (antes de construir `connect_server`)

1. Instalar un conector con OAuth en `mcp.json` de una carpeta de datos temporal.
2. En `<datos>/agent/login/`, `claude mcp add --scope local --transport http <n> <url>`
   (escribe en `~/.claude.json` bajo esa ruta, no bajo ningún proyecto del usuario).
3. `claude mcp login <n>` en una ventana visible; Sofía inicia sesión.
4. `claude -p --strict-mcp-config --mcp-config <config de Sens>` en otra carpeta:
   ¿aparecen sus herramientas en `system/init`?

Sí → `connect_server` hace 2 y 3. No → `installable: false` para `login: true`.

## Frontend

### Vista Capacidades

Selector arriba a la derecha **Instaladas | Explorar**, recordado en
`sens.capabilities.mode`.

**Instaladas** es la vista v2 con una pestaña más: `Todas`, `Plugins`, `Skills`,
`MCP`, `Activas`. Tarjeta de plugin con icono Lucide `package`. Pulsar cualquier
tarjeta abre su página de detalle (las creadas o importadas a mano, sin ficha, abren
su `SKILL.md` como ahora).

**Explorar**:

```
[🔍 Busca plugins, skills o conectores…                        ]
Tipo: Todo · Plugins · Skills · Conectores
Fuente: Todas · Anthropic · Comunidad · skills.sh
[tarjeta] [tarjeta] [tarjeta]
                  [Ver más]
Catálogo del 23 sept, 18:40 · Actualizar catálogo
```

- Búsqueda local en nombre, título, descripción, autor y categoría, sin mayúsculas
  ni tildes (la función `plain` de hoy). skills.sh con debounce de 300 ms y 2+
  letras; sus resultados se mezclan, deduplicados por id.
- Orden sin búsqueda: `anthropic`, `partner`, `community`, `skills.sh`; dentro, por
  nombre. Con búsqueda: coincidencia en nombre primero.
- 60 tarjetas y «Ver más» (+60). Tarjeta: icono (`package`, `book-open`, `plug`),
  micro label del tipo, título, descripción en 2 líneas, pie con la etiqueta de
  fuente, autor, instalaciones (skills.sh) o `🔑` si pide sesión, e «Instalada» si
  lo está.
- Fuente con error: una línea `.none` con el motivo bajo los chips.

### Página de detalle

Sustituye a la lista dentro de la vista; «← Capacidades» vuelve a donde estaba
(modo, filtros, búsqueda y scroll).

```
← Capacidades
PLUGIN · Anthropic
code-review                                   [Instalar]  [Ver fuente]
Anthropic · v1.2.0 · Apache-2.0
Revisa pull requests con agentes especializados…
Resumen · Contenido · Qué ejecuta
```

- **Resumen**: `readme` con `prose()`. Conectores: descripción y lista de herramientas.
- **Contenido**: a la izquierda los grupos (Skills, Comandos, Agentes, Hooks, MCP,
  LSP, Todos los ficheros); a la derecha el `.md` elegido con `prose()` (sin la
  cabecera `---`), o el texto en `<pre>` si no es markdown. Bajo 720 px se apilan.
- **Qué ejecuta**: comandos de hooks, cómo se lanza cada servidor MCP (comando o
  URL), ficheros de `bin/`, variables que pide, y «Pide iniciar sesión» si aplica.
  Si no ejecuta nada: `No ejecuta código: solo instrucciones.`
- Botones según estado: `Instalar` · `Instalando…` · interruptor `Activar en
  <proyecto>` + `⋯` (`Actualizar` si hay versión nueva, `Desinstalar`) · `Conectar`
  para conectores con OAuth. `Ver fuente` abre `homepage` o el repo fuera.
- Instalar: si ejecuta código o pide variables, `panelForm` de confirmación con la
  lista de «Qué ejecuta» y un campo por variable (secretas como password); si no,
  instala directamente. Al acabar: instalada y activa en el proyecto abierto.
- Enlaces del markdown: se abren fuera solo si son http(s). Imágenes: su texto
  alternativo como enlace (la CSP no las carga).

Signal: nada nuevo; el tinte sigue solo en la tarjeta destacada de Instaladas.

## Fuera de alcance

Registro abierto de MCP, Docker, Smithery y Glama; actualizaciones automáticas;
`userConfig` de plugins más allá de variables; orígenes `npm`/`archive`/`command` y
hosts git que no sean GitHub; logos de terceros (solo Lucide); comprobar las
herramientas de un servidor arrancándolo.

## Pruebas

- Unitarias (fixtures reales recortados en `rust/sens-app/tests/fixtures/market/`):
  normalizar cada fuente; etiquetas `anthropic`/`partner`/`community`; filtro de
  licencia en las tres fuentes; resolver los cuatro orígenes; extracción segura
  (`..`, absolutas, enlaces, topes, sin restos); `plugin.json` de `strict:false` y
  rechazo si choca; `needs` desde `${VAR}` y `headers`; instalar, activar, quitar y
  actualizar plugins; varios `--plugin-dir` y el entorno en `launch()`; conectores
  `http`/`sse` en la config generada; `env` reinicia el proceso.
- En vivo (`#[ignore]`): bajar los catálogos reales; instalar `code-review` de
  `official` y verlo en `system/init` de un `claude -p`.
- UI en el arnés `ui-harness` con el simulador.

## Estado (2026-09-23, fin del día)

Implementado y probado contra las fuentes reales: 3.095 fichas en 2,1 s (311 +
120 + 19 + 21 + 2.282 plugins, 15 skills, 327 conectores); 2.825 instalables. Un
plugin oficial instalado (`code-review`) aparece en `system/init` de `claude -p`
como `code-review@inline` con su comando `/code-review:code-review`.

Diferencias con lo escrito arriba:

- `market_update` recibe también `name` (el nombre instalado, que la UI saca de
  `origins`).
- La cabecera de un `.md` (`capabilities::front_matter`) entiende bloques YAML
  `>`/`|` y salta claves anidadas; lo usan `header()` e importar. `academy-guide`
  lo necesitaba.
- Las variables obligatorias van primero en el formulario.

Pendiente: la prueba de OAuth. Hasta entonces los conectores con `login: true`
salen con `installable: false` y la ficha lo explica; `connect_server` no existe.
