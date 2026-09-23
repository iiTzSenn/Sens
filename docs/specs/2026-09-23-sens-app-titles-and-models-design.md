# Nombres de sesión por IA y todos los modelos de Claude Code

Fecha: 2026-09-23 · Ámbito: `rust/sens-agent` (`catalog.rs`, `session.rs`, `title.rs`),
`rust/sens-app` (`main.rs`, `ui/index.html`). Implementado.

## Nombres de sesión

- Al terminar cada turno (`finished` o `failed`) la UI llama a `title_session`. El
  backend solo actúa si la sesión aún no tiene nombre y ya tiene una tarea y una
  respuesta (`Said`); si no, devuelve `null` sin coste.
- `title::suggest` lanza `claude -p --model haiku --output-format json --max-turns 1
  --tools "" --strict-mcp-config --disable-slash-commands --no-session-persistence
  --settings {"disableAllHooks":true} --thinking disabled --system-prompt <brief>` con
  la primera tarea y la primera respuesta, recortadas a 1.500 caracteres cada una.
  Pide 3 a 6 palabras en el idioma de la persona. Tarda unos 4 s.
- El título se guarda como una entrada nueva del `.jsonl`:
  `{"kind":"titled","at":…,"title":…,"by":"ai"|"user"}`. `summarize` usa la última;
  sin ninguna, el primer mensaje recortado como antes. Si la llamada falla no se
  muestra nada y se reintenta al acabar el siguiente turno.
- `⋯` → **Renombrar**: el nombre pasa a ser un campo con el texto seleccionado.
  Enter guarda, Esc cancela, un nombre vacío o igual no hace nada. Hacer clic en
  otra parte de Sens guarda; perder el foco de la ventana (Alt+Tab, notificaciones)
  no. `rename_session` escribe `by: "user"` donde viva la sesión, archivada o no,
  y un nombre del usuario impide para siempre el de la IA.

| Comando | Firma JS | Devuelve |
| --- | --- | --- |
| `title_session` | `invoke("title_session", { root, id })` | `string \| null` |
| `rename_session` | `invoke("rename_session", { root, id, title })` | `string` (el guardado, recortado a 56) |

## Todos los modelos

- `catalog::discover` ya no hace cuatro llamadas de sondeo al modelo. Abre un
  `claude -p` en stream-json con `--strict-mcp-config --settings
  {"disableAllHooks":true}`, envía `control_request {subtype:"initialize"}`, lee
  `response.models` y cierra el proceso: ~1,1 s y sin tokens.
- Cada entrada es una tarjeta: `id = resolvedModel`, `label = displayName`,
  `description`, `efforts` = los que declara el CLI (vacío si `supportsEffort` no es
  `true`). Se salta `default` y se deduplica por `resolvedModel`. `latest` marca el
  primer modelo de cada familia en el orden del CLI. El esfuerzo por defecto y si
  razona siempre siguen saliendo de la tabla de familias; si el CLI no declara el
  esfuerzo por defecto se cae a `high` y luego al primero.
- El selector muestra los `latest` con su descripción traducida y debajo el grupo
  **Anteriores**. La caché de la UI pasa a `sens.models.v3`.
