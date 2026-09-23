# Capacidades: skills y servidores MCP

Fecha: 2026-09-23 · Ámbito: `rust/sens-app` (Rust + `ui/index.html`)
Depende de: `2026-09-23-sens-app-sidebar-design.md`, `2026-09-23-sens-app-artifacts-design.md`.

## Tarea del usuario

Ver y gestionar qué skills y servidores MCP tiene Sens: añadir, activar,
desactivar y quitar. La acción focal es el interruptor de cada fila.

## Fuera de alcance

- Que el agente use skills o MCP (spec aparte, toca `sens-agent`).
- Probar la conexión de un servidor MCP.
- Editar un servidor: se quita y se vuelve a añadir.
- Leer configuración de Claude Code u otras herramientas.
- Capacidades por proyecto. Todo es global.

## Almacenamiento (`app_data_dir()`)

```
skills/<nombre>/SKILL.md      una carpeta por skill, puede traer más ficheros
mcp.json                      servidores MCP
capabilities.json             { "disabled": ["nombre-de-skill", …] }
```

`SKILL.md`:

```
---
name: revisar-prs
description: Revisa un PR contra la guía del equipo.
---

Instrucciones en Markdown…
```

La cabecera se lee con un parser propio de `clave: valor` entre las dos líneas
`---` (valores opcionalmente entre comillas simples o dobles). Faltan `name` o
`description` → la skill no es válida.

`mcp.json` (se escribe con claves ordenadas):

```json
{ "servers": { "github": { "command": "npx", "args": ["-y", "@x/github"], "env": { "TOKEN": "…" }, "enabled": true } } }
```

## Reglas

- Nombre de skill: `^[a-z0-9][a-z0-9-]{0,63}$`. Nombre de servidor:
  `^[A-Za-z0-9_-]{1,64}$`. Descripción obligatoria, máx. 1024 caracteres.
  Comando obligatorio. Nombres únicos: repetir uno es un error, no una
  sobrescritura.
- Una carpeta en `skills/` sin `SKILL.md` válido no aparece en la lista.
- Importar copia la carpeta elegida entera a `skills/<name de la cabecera>`.
  Límites: 200 ficheros y 10 MB en total; no sigue enlaces simbólicos; si algo
  falla, no deja una copia a medias.
- Quitar una skill borra su carpeta, solo si el nombre es válido y la carpeta
  está dentro de `skills/`.
- Todos los errores son `Err` con un mensaje en español.

## Backend (Rust, `rust/sens-app/src/capabilities.rs`)

Funciones puras sobre un directorio base, testeables con un temporal. Reutiliza
`store::stored` / `store::store` para los JSON.

| Comando | Firma JS | Devuelve |
| --- | --- | --- |
| `capabilities` | `invoke("capabilities")` | `{ skills: Skill[], servers: Server[] }` |
| `skill_text` | `invoke("skill_text", { name })` | `string`, el `SKILL.md` completo |
| `create_skill` | `invoke("create_skill", { name, description, body })` | `null` |
| `import_skill` | `invoke("import_skill", { path })` | `string`, el nombre importado |
| `remove_skill` | `invoke("remove_skill", { name })` | `null` |
| `set_skill` | `invoke("set_skill", { name, enabled })` | `null` |
| `add_server` | `invoke("add_server", { server: { name, command, args, env } })` | `null` |
| `remove_server` | `invoke("remove_server", { name })` | `null` |
| `set_server` | `invoke("set_server", { name, enabled })` | `null` |

- `Skill`: `{ name, description, enabled }`, ordenadas por nombre.
- `Server`: `{ name, command, args, envKeys, enabled }`, ordenados por nombre.
  Los valores de `env` nunca salen hacia la UI.
- `add_server` guarda `enabled: true`. `env` llega como objeto `{ CLAVE: valor }`.

## Frontend (`ui/index.html`)

### Barra

Fila `.nav-row#capabilities` entre "Sesión nueva" y "Artefactos", icono Lucide
`shapes`, texto `Capacidades`. Misma lógica de `aria-current` que Artefactos:
solo una fila marcada.

### Vista

Sustituye al chat como Artefactos, con el mismo mecanismo de entrada y salida
(sesión, "Sesión nueva", `Ctrl+N`). Las pestañas son el mismo componente que
usa Artefactos: si hoy está atado a esa vista, se generaliza y lo usan las dos.

```
Skills 2   MCP 1                                   [+ Añadir]
Sens guarda estas capacidades; el agente aún no las usa.

  revisar-prs        Revisa un PR contra la guía…          [●—]  ⋯
  github             npx -y @x/github · TOKEN              [●—]  ⋯
```

- Pestañas `Skills` y `MCP` con recuento; la elegida se recuerda en
  `localStorage` (`sens.capabilities.tab`, con try/catch).
- Aviso en 13 px `--ghost` bajo las pestañas, texto exacto:
  `Sens guarda estas capacidades; el agente aún no las usa.`
- Fila de 44 px: nombre en 13/500 `--text`; debajo, descripción (skills) o
  `comando args` en mono con las claves de entorno detrás de `·` (MCP), en
  `--faint` con elipsis. A la derecha un interruptor `role="switch"` con
  `aria-checked` y `aria-label="Activar <nombre>"`: apagado, pista `--raise` y
  mando `--faint`; encendido, pista `--dim` y mando `--ground`. Nunca Signal.
  Después, un botón `⋯` (Lucide `ellipsis`) con un menú `.sheet` de una
  entrada, `Quitar`, que pide confirmación en el `<dialog>` existente
  (`Quitar <nombre>` / botón en `--red`).
- Pulsar una skill (fuera del interruptor y del `⋯`) abre su `SKILL.md` en el
  panel de código con el renderizador Markdown que ya existe.
- `+ Añadir` (Lucide `plus`), arriba a la derecha:
  - en Skills abre un menú `.sheet` con `Crear skill` e `Importar carpeta`.
    Crear abre el `<dialog>` con Nombre, Descripción e Instrucciones
    (textarea); Importar usa `dialog.open({ directory: true })`.
  - en MCP abre el `<dialog>` con Nombre, Comando, Argumentos (uno por línea) y
    Variables de entorno (`CLAVE=valor`, una por línea; los valores en un
    `textarea` normal, se envían y no se vuelven a mostrar).
  - Errores bajo el formulario, que no se cierra. Si sale bien, se cierra y se
    repinta la lista.
- Vacío por pestaña, mismo patrón que Artefactos: icono `shapes` a 24 px,
  `No hay skills` / `No hay servidores MCP` en 15/600 y debajo
  `Añade una skill para darle instrucciones reutilizables al agente.` /
  `Añade un servidor MCP para darle herramientas nuevas al agente.`
- Error de `capabilities`: línea `.none .fault`.

## Pruebas

- Rust: parser de cabecera (comillas, espacios, falta de campos, sin cabecera);
  validación de nombres; crear → listar → texto; nombre repetido; importar
  copia todo, rechaza sin `SKILL.md`, respeta límites y no deja restos; quitar
  borra solo dentro de `skills/`; activar/desactivar skill y servidor; los
  valores de `env` no aparecen en `capabilities`.
- UI: vista previa con stub y app nativa.

## Identidad

Tokens existentes, Lucide SVG 16 px trazo 1.5 (24 px trazo 1.75 en vacío),
sin Signal nuevo, sin comentarios en ningún fichero.
