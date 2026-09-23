# Artefactos: imágenes, ficheros y enlaces de las sesiones

Fecha: 2026-09-23 · Ámbito: `rust/sens-app` (Rust + `ui/index.html`)
Depende de: `2026-09-23-sens-app-sidebar-design.md` (registro de proyectos).

## Tarea del usuario

Encontrar lo que salió de una sesión sin volver a leerla: una imagen, un
documento o un enlace. La acción focal es abrir el artefacto.

## Fuera de alcance

- Que el agente genere artefactos. Eso toca `sens-agent` y va en un spec aparte.
  Esta parte muestra lo que haya en disco y los enlaces de los logs.
- Borrar, renombrar o exportar artefactos.

## Dónde viven

```
<root>/.sens/artifacts/<sessionId>/<fichero>   artefacto de una sesión
<root>/.sens/artifacts/<fichero>               artefacto sin sesión
```

Sin índice aparte: la sesión es el nombre de la carpeta. Solo un nivel de
subcarpeta; lo que haya más hondo se ignora. Se ignoran los ficheros ocultos.

## Tipos

- `image`: `png jpg jpeg gif webp svg` (sin distinguir mayúsculas).
- `file`: cualquier otro fichero.
- `link`: URL `http://` o `https://` encontrada en el log de una sesión, solo en
  - el texto de las entradas `task`, cortado antes del primer `"\n\n--- "` (lo que
    va detrás son ficheros adjuntos, no enlaces usados);
  - el campo `note` de los pasos `proposed`.
  Una URL termina en espacio, comillas, `<`, `>` o fin de texto; se le quitan
  `.,;:!?` y `)` `]` finales sin pareja. Se deduplica por sesión (se queda la
  primera aparición). Las sesiones con `tasks == 0` no cuentan.

## Backend (Rust, `rust/sens-app/src/artifacts.rs`)

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub kind: Kind,
    pub root: String,
    pub project: String,
    pub name: String,
    pub target: String,
    pub session: Option<String>,
    pub session_title: Option<String>,
    pub at: u64,
    pub bytes: Option<u64>,
}

#[derive(Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind { Image, File, Link }
```

- `target`: ruta absoluta del fichero, o la URL.
- `name`: nombre del fichero, o `host + ruta` de la URL sin esquema.
- `at`: fecha de modificación del fichero en ms, o el `at` de la entrada del log.
- `session_title`: el `title` de `session::summarize` de esa sesión, si existe.
- Funciones puras testeables: `urls_in(text) -> Vec<String>`,
  `links_of(id, entries) -> Vec<Artifact>` (o equivalente) y
  `files_of(root) -> Vec<Artifact>`.

### Comandos nuevos

| Comando | Firma JS | Devuelve |
| --- | --- | --- |
| `artifacts` | `invoke("artifacts")` | `Artifact[]` de todos los proyectos del registro que existen, ordenado por `at` descendente |
| `artifact_data` | `invoke("artifact_data", { path })` | `string`: data URL `data:<mime>;base64,…` para imágenes |
| `artifact_text` | `invoke("artifact_text", { path })` | `string`: contenido UTF-8 para ficheros de texto |
| `open_external` | `invoke("open_external", { target })` | `null`: abre la URL en el navegador o el fichero con su app del sistema |

Seguridad: `artifact_data`, `artifact_text` y `open_external` con ruta solo
aceptan ficheros dentro de `<root>/.sens/artifacts/` de un proyecto del
registro (comparar rutas canonicalizadas). `open_external` con URL solo acepta
`http://` y `https://`. Cualquier otra cosa devuelve `Err` en español.
Límites: `artifact_data` rechaza ficheros de más de 8 MB y `artifact_text` de
más de 1 MB.

`open_external` usa `tauri-plugin-opener` desde Rust (`OpenerExt`). Es la única
dependencia nueva; se registra el plugin en `main` y no se exponen permisos del
plugin al JS, porque la UI solo llama al comando.

## Frontend (`ui/index.html`)

### Barra lateral

Debajo de "Sesión nueva", una fila igual (`.nav-row`) con el icono Lucide
`files` y el texto `Artefactos`, sin atajo. `aria-current="true"` cuando la
vista de artefactos está abierta; entonces "Sesión nueva" no está marcada.

### Vista

Ocupa la columna central en lugar del chat (`section.chat` se oculta; el panel
de código de la derecha sigue funcionando). Se sale de ella al elegir una
sesión, "Sesión nueva" o `Ctrl+N`.

```
Todo 7   Imágenes 2   Ficheros 3   Enlaces 2

  [img]  captura-login.png        coinpla · Añade validación…   10:33
  [doc]  informe.md               coinpla · Añade validación…   10:31
  [url]  docs.rs/serde/latest     Fichaje · Revisa el cálculo…  ayer
```

- **Pestañas**: `Todo`, `Imágenes`, `Ficheros`, `Enlaces`, con el recuento en
  mono 11 px `--ghost`. La activa en `--text` con un subrayado de 1 px
  `--edge` (no Signal: no es resultado de análisis). `role="tablist"`,
  flechas izquierda/derecha. La pestaña elegida se recuerda en `localStorage`
  (`sens.artifacts.tab`, con try/catch).
- **Imágenes**: rejilla de miniaturas cuadradas de 120 px, radio
  `--r-control`, borde `--hair`, con el nombre debajo. Las miniaturas se
  cargan con `artifact_data` cuando entran en pantalla
  (`IntersectionObserver`).
- **Todo / Ficheros / Enlaces**: filas de 36 px. Icono Lucide a 16 px
  (`image`, `file-text`, `link`), nombre (mono para enlaces y rutas),
  `proyecto · título de sesión` en `--faint` con elipsis, y hora con el mismo
  formato corto que la barra.
- **Abrir**:
  - imagen → diálogo modal (el `<dialog>` que ya existe) con la imagen a
    tamaño de ajuste y el nombre;
  - `md`, `txt`, `json`, `csv`, `log` y extensiones de código → panel de código
    de la derecha con `artifact_text`; `md` se pinta con un renderizador mínimo
    propio (títulos, listas, negrita, cursiva, código en línea y en bloque,
    enlaces como texto), sin librerías;
  - `html` → el mismo diálogo con un `<iframe sandbox srcdoc>` (sin scripts);
  - resto (pdf, docx…) y enlaces → `open_external`.
  - Cada fila lleva además la sesión como enlace secundario: al pulsar el
    título de sesión se abre esa sesión en el chat.
- **Vacío** (en la pestaña actual): centrado, icono Lucide `files` a 24 px
  trazo 1.75 en `--ghost`, `No hay artefactos` en 15/600 `--text` y debajo
  `Las imágenes, ficheros y enlaces aparecerán aquí según los produzcan las sesiones.`
  en 13 px `--faint`.
- **Error** de `artifacts`: línea `.none .fault` en la vista con el motivo.
- La vista se recarga al abrirla y al terminar un trabajo (`done`) si está
  abierta.

## Pruebas

- Rust: `urls_in` (corte de puntuación, paréntesis con pareja como en
  Wikipedia, varias URLs, texto sin URLs); enlaces solo de `task` antes de
  adjuntos y de `proposed.note`, deduplicados; `files_of` clasifica por
  extensión, asigna sesión por carpeta, ignora ocultos y niveles profundos; la
  validación de rutas rechaza fuera de `.sens/artifacts` y `..`.
- UI: vista previa con stub y app nativa.

## Identidad

Tokens existentes, Lucide en SVG a 16 px trazo 1.5, Signal solo donde ya está
(sesión activa, foco). Sin comentarios en ningún fichero.
