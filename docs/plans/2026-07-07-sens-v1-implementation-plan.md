# Sens — Plan de implementación (v1)

- **Fecha:** 2026-07-07
- **Diseño de referencia:** [../specs/2026-07-07-sens-design.md](../specs/2026-07-07-sens-design.md)
- **Estado:** Propuesto

Este plan convierte el diseño en hitos construibles. Cada hito es **independientemente probable** y aporta valor por sí mismo. El orden sigue las dependencias: primero el índice (la base), luego el motor de consultas, luego las dos "salidas" (MCP para Claude, CLI/reporte para humanos).

---

## Decisiones técnicas ya tomadas

Lo que el diseño dejaba abierto, aquí se concreta:

| Área | Decisión | Motivo |
|---|---|---|
| Runtime | Node.js ≥ 18 + TypeScript | Estándar del ecosistema; necesario para el SDK de MCP |
| Parser JS/TS | **`ts-morph`** (envuelve la API del compilador de TS) | Da resolución real de imports/exports y `findReferences()` — justo lo que necesitan `who_uses` y `dead_code`. Evita reinventar la resolución de módulos |
| Walker de archivos | `globby` (con `gitignore: true`) | Respeta `.gitignore` sin código extra |
| CLI | `commander` | Maduro y conocido; subcomandos claros |
| Colores/formato | `picocolors` | Mínimo, sin dependencias |
| Tests | `vitest` | Rápido, TS nativo |
| Build/bundle | `tsup` | Empaqueta CLI + servidor MCP para `npx` con config mínima |
| MCP | `@modelcontextprotocol/sdk` | SDK oficial |
| Distribución | 1 binario `sens`; `sens mcp` arranca el servidor MCP (stdio) | Un solo paquete, dos usos |

**Estructura del proyecto:**

```
sens/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # entrada como librería
│   ├── cli.ts            # entrada CLI (bin "sens")
│   ├── indexer/          # recorre + parsea + construye el grafo
│   ├── store/            # persistencia + reindexado incremental
│   ├── query/            # las 6 consultas
│   ├── mcp/              # servidor MCP (envuelve query/)
│   └── report/           # generador de HTML
├── test/
│   └── fixtures/         # mini-repos JS/TS para probar
├── docs/{specs,plans}/
├── README.md
└── LICENSE               # MIT
```

---

## Hito 0 — Andamiaje

**Objetivo:** un proyecto TS que compila, con CLI vacía que responde.

- Inicializar `package.json`, `tsconfig.json`, `.gitignore` (node_modules, `.sens/`, dist).
- Configurar `vitest`, `tsup`, y el bin `sens`.
- CLI esqueleto con `commander`: `sens --version` y subcomandos vacíos (`index`, `map`, `dead-code`, `report`, `mcp`).
- LICENSE (MIT).

**Se prueba:** `npx sens --version` y `npx sens --help` funcionan.

---

## Hito 1 — Indexer + Store (la base)

**Objetivo:** dado un proyecto JS/TS, producir un índice fresco y cacheado.

- **Modelo de datos del índice:**
  - `File { path, mtime, exports[] }`
  - `Symbol { name, kind (function|class|const|type|…), file, line, signature, exported }`
  - `Reference { symbol, file, line }` (quién usa a quién)
- **Indexer:** con `globby` recorrer archivos `.js/.ts/.tsx/.vue?`, con `ts-morph` extraer símbolos, firmas y referencias, y el grafo de imports/exports.
- **Store:** serializar a `.sens/index.json`; al indexar, comparar `mtime` y **reindexar solo los archivos cambiados**.

**Se prueba:** contra un fixture, el índice contiene los símbolos y referencias esperados; al tocar un archivo, solo ese se reindexa (test de incrementalidad).

---

## Hito 2 — Motor de consultas

**Objetivo:** las 6 consultas del diseño, funcionando sobre el índice.

- `project_map`, `find_symbol`, `who_uses`, `file_outline`.
- `already_exists` — matching por nombre/palabras clave sobre nombres de símbolos + resúmenes (no semántico en v1).
- `dead_code` — símbolos con cero referencias que no sean puntos de entrada.
- **Config de excepciones** (`sens.config.json`): `entryPoints[]`, `ignore[]`, y por defecto respetar tests y auto-imports comunes (Nuxt/Vue) y exports de API pública.
- Salidas **compactas** (formato pensado para gastar pocos tokens).

**Se prueba:** cada consulta contra el fixture; `dead_code` detecta lo muerto real **sin** marcar auto-imports/tests (test anti-falsos-positivos).

---

## Hito 3 — Servidor MCP (para Claude Code)

**Objetivo:** Claude Code puede usar las 6 consultas.

- Con `@modelcontextprotocol/sdk`, exponer las 6 herramientas (esquemas de entrada + salida compacta), sobre stdio, arrancadas con `sens mcp`.
- Snippet de instalación para Claude Code (`.mcp.json` / plugin).

**Se prueba:** conectar el servidor a Claude Code real y comprobar que las herramientas responden y que Claude resuelve una tarea **leyendo menos archivos** que sin Sens.

---

## Hito 4 — CLI pulida + Reporte HTML

**Objetivo:** la capa visible para humanos.

- `sens index | map | dead-code` con salida con colores/tablas (`picocolors`).
- `sens report` → **HTML estático autocontenido** (CSS/JS inline): mapa del proyecto, código muerto y **ahorro estimado** (heurística: tokens de "leer todo" vs "consultar Sens").

**Se prueba:** `sens report` genera un HTML abrible y presentable; captura lista para el README.

---

## Hito 5 — Empaquetado y lanzamiento

**Objetivo:** que cualquiera pueda instalarlo y que el repo enganche en GitHub.

- README en inglés con captura del reporte + instrucciones de instalación (CLI y conexión a Claude Code).
- Publicar en npm como `sens-mcp` (o scoped).
- Repo público, LICENSE MIT, un ejemplo real corrido sobre un repo de muestra.

**Se prueba:** instalación limpia desde cero siguiendo solo el README.

---

## Estrategia de pruebas

- **Unitarias (`vitest`)** por componente (indexer, store, cada consulta).
- **Fixtures:** mini-repos JS/TS en `test/fixtures/` con casos preparados (código muerto real, auto-imports que NO son muertos, duplicados obvios).
- **End-to-end manual** en el Hito 3 conectando a Claude Code de verdad.

## Riesgos de implementación

| Riesgo | Mitigación |
|---|---|
| `ts-morph` puede ser lento en repos enormes | Reindexado incremental (Hito 1) + cargar solo lo necesario; medir en un repo grande temprano |
| `findReferences` no ve usos dinámicos/plantillas Vue | Documentar el límite; tratar `dead_code` como "candidatos"; permitir excepciones |
| Formato de salida no lo bastante compacto | Iterar el formato en el Hito 3 midiendo tokens reales |

## Orden sugerido de trabajo

`Hito 0 → 1 → 2` es el camino crítico (sin índice no hay nada). `Hito 3` y `Hito 4` pueden ir casi en paralelo una vez existe el motor de consultas. `Hito 5` cierra.
