# Capacidades v2: activación por proyecto y vista en tarjetas

Fecha: 2026-09-23 · Ámbito: `rust/sens-app` (Rust + `ui/index.html`), marca.
Sustituye en lo que choque a `2026-09-23-sens-app-capabilities-design.md`.

## Decisiones

- Tinte Signal en la marca: dos tokens nuevos para una superficie destacada por pantalla.
- Sin catálogo: solo lo instalado por el usuario.
- Se instala una vez para todo Sens; se activa o desactiva por proyecto.

## Marca

Tokens nuevos (primitivos, en `src/brand/tokens.ts` y en el `:root` de `index.html`):

| Token | Hex | Uso |
| --- | --- | --- |
| `signal-tint-900` | `#1a1f16` | Fondo de la única superficie destacada de la pantalla |
| `signal-tint-700` | `#353e2a` | Su borde |

Regla (en `docs/brand/identity.md` §3.2): el tinte no es Signal pleno; va en una
sola superficie destacada por pantalla, nunca como fondo de página ni de panel.

## Backend

### Almacenamiento

- `skills/` y `mcp.json` no cambian de sitio. El campo `enabled` de cada
  servidor en `mcp.json` deja de leerse y de escribirse.
- `capabilities.json` pasa a ser:

```json
{ "projects": { "P:\\SGT-Portal": { "skills": ["revisar-prs"], "servers": ["github"] } } }
```

  Listas ordenadas y sin duplicados. Un `capabilities.json` antiguo (con
  `disabled`) se lee como vacío sin fallar. Un fichero dañado bloquea el
  guardado igual que `mcp.json` (`store::editable`).

### Contrato

| Comando | Firma JS | Devuelve / efecto |
| --- | --- | --- |
| `capabilities` | `invoke("capabilities", { root })` | `{ skills: [{ name, description, enabled }], servers: [{ name, command, args, envKeys, enabled }] }`; `enabled` es para `root`; `root` puede ser `""` y entonces todo `false` |
| `set_skill` | `invoke("set_skill", { root, name, enabled })` | `null`; `root` vacío es error |
| `set_server` | `invoke("set_server", { root, name, enabled })` | `null`; `root` vacío es error |
| `create_skill` | `invoke("create_skill", { root, name, description, body })` | `null`; si `root` no está vacío, la activa ahí |
| `import_skill` | `invoke("import_skill", { root, path })` | `string`; igual activación |
| `add_server` | `invoke("add_server", { root, server })` | `null`; igual activación |
| `remove_skill` | `invoke("remove_skill", { name })` | `null`; también la quita de todos los proyectos |
| `remove_server` | `invoke("remove_server", { name })` | `null`; también de todos los proyectos |
| `skill_text` | sin cambios | |

Activar algo que no existe es error. Las rutas de proyecto se comparan tal cual,
como en `projects.rs`.

## Frontend

```
CAPACIDADES
Skills y servidores MCP que Sens puede usar en tus sesiones.   [+ Añadir]

┌ tarjeta destacada (signal-tint-900 / borde signal-tint-700, r 12) ┐
│ SGT-PORTAL                                                       │
│ 2 skills y 1 MCP activos en este proyecto                        │
└──────────────────────────────────────────────────────────────────┘
Todas 3   Skills 2   MCP 1   Activas 3
[buscar]
[tarjeta] [tarjeta]
🛡 Tú decides qué se activa en cada proyecto.
```

- Cabecera: micro label `Capacidades`; debajo, 13 px `--faint`:
  `Skills y servidores MCP que Sens puede usar en tus sesiones.`; a la derecha
  `+ Añadir` (el mismo menú actual: en pestaña MCP abre el formulario de
  servidor; en el resto, el menú `Crear skill` / `Importar carpeta` / `Añadir servidor MCP`).
- Desaparece la línea "Sens guarda estas capacidades; el agente aún no las usa."
  de la cabecera; pasa como segunda línea de la tarjeta destacada en 12 px
  `--ghost`: `El agente aún no las usa en sus tareas.`
- Tarjeta destacada: micro label con el nombre del proyecto abierto; texto en
  15/600 `--text` con el recuento real (`N skills y M MCP activos en este
  proyecto`, con singulares correctos; `Nada activo en este proyecto` si 0).
  Sin proyecto: label `Sin proyecto` y texto `Abre un proyecto para activar capacidades.`
- Pestañas (componente compartido): `Todas`, `Skills`, `MCP`, `Activas`, con
  recuento; recordada en `sens.capabilities.tab`.
- Buscador bajo las pestañas: campo con icono Lucide `search`, placeholder
  `Buscar una skill o servidor…`, filtra por nombre, descripción y comando sin
  distinguir mayúsculas ni tildes. Si no hay resultados: `.none` `Nada coincide.`
- Rejilla de tarjetas `repeat(auto-fill, minmax(240px, 1fr))`, gap 12 px.
  Tarjeta: `--card`, borde `--hair-strong`, radio `--r-card`, padding 16 px.
  Arriba: cuadro de 32 px `--raise` radio `--r-control` con icono Lucide
  (`book-open` skill, `plug` MCP) a 16 px en `--faint`; a la derecha micro label
  `SKILL` / `MCP`. Nombre en 15/600; descripción o `comando args · CLAVES`
  (mono) en 13 px `--faint`, máx. 2 líneas. Abajo: `⋯` (menú Quitar como ahora)
  y el interruptor actual con `aria-label="Activar <nombre> en <proyecto>"`,
  deshabilitado sin proyecto. Pulsar la tarjeta de una skill abre su
  `SKILL.md` como ahora.
- Pie: icono Lucide `shield-check` 16 px `--ghost` + 12 px `--ghost`:
  `Tú decides qué se activa en cada proyecto.`
- Vacíos por pestaña: los actuales; `Activas` vacía: `Nada activo en este proyecto`
  / `Activa una skill o un servidor desde su tarjeta.`
- La vista se recarga al cambiar de proyecto (`enter`).
- Signal: ninguno nuevo. El tinte solo en la tarjeta destacada.
