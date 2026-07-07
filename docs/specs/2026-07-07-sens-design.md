# Sens — Documento de diseño (v1)

- **Fecha:** 2026-07-07
- **Estado:** Aprobado (diseño). Pendiente de plan de implementación.
- **Nombre del proyecto / marca / comando:** `sens`
- **Nombre de publicación en npm:** `sens-mcp` o scoped `@<usuario>/sens` (el paquete `sens` a secas está ocupado en npm por un placeholder).

---

## 1. Resumen

**Sens** es una herramienta para **Claude Code** que construye un **índice del proyecto** y se lo sirve al modelo a través de un **servidor MCP**, para que Claude **consulte** el proyecto en vez de leerlo entero.

El resultado doble:
- **Menos tokens / menos contexto** → la suscripción del usuario cunde más y las sesiones largas no se degradan por compactación.
- **Código más limpio** → Claude reutiliza lo que ya existe (en vez de duplicar) y se detecta el código muerto.

## 2. Problema

Los usuarios de Claude Code con **suscripción** (no API de pago por token) tienen un **límite de uso** por ventana de tiempo. Dos cosas agotan ese límite y degradan la calidad:

1. **Re-lectura / re-exploración:** el agente abre muchos archivos enteros para orientarse, lo que llena la ventana de contexto (que luego se "compacta" y pierde memoria) y consume cupo.
2. **Código que crece de más:** duplicados y código muerto hacen el proyecto más caro de leer y más difícil de razonar.

## 3. Objetivos y no-objetivos

**Objetivos (v1):**
- Reducir los tokens que Claude gasta para orientarse en un proyecto.
- Ayudar a Claude a **reutilizar** código existente en vez de duplicarlo.
- Detectar **código muerto** (símbolos/exports sin usos).
- Ofrecer una **capa visible para humanos** (CLI + reporte HTML) atractiva para GitHub.

**No-objetivos (v1):**
- No es un motor de reglas de "escribir menos" (eso lo cubre bien [ponytail](https://github.com/DietrichGebert/ponytail); Sens lo **complementa**, no compite).
- No hooks de enforcement, ni detección de duplicados "parecidos" (fuzzy), ni métricas de complejidad.
- No multi-lenguaje ni dashboard web en vivo.
- No enfocado a usuarios de API-key (aunque también les serviría).

## 4. Público y posicionamiento

**Público:** desarrolladores que usan **Claude Code con suscripción** (Pro/Max), sobre todo en proyectos JS/TS medianos o grandes.

**Posicionamiento clave (frente a ponytail):**
> Ponytail pone las **reglas** ("reutiliza lo que ya existe, escribe lo mínimo"). Pero no le da al agente ninguna forma eficiente de **saber qué existe** — tiene que encontrarlo leyendo/grepeando, y a menudo falla y duplica igual.
>
> **Sens es esa pieza que falta: el índice/conocimiento del proyecto** que convierte "reutiliza" en algo real y barato. Ponytail son las reglas; Sens es la memoria que las hace funcionar.

Ambos son **complementarios**: un usuario puede tener los dos.

## 5. Arquitectura

Seis componentes con responsabilidad única:

1. **Indexer (Indexador)**
   - **Qué hace:** recorre el proyecto, parsea cada archivo soportado y construye el grafo: definiciones de símbolos (funciones, clases, exports), referencias (quién-usa-qué) e imports/exports entre archivos.
   - **Depende de:** un walker de archivos (respetando `.gitignore`) y un analizador de JS/TS que resuelva imports de verdad.
   - **Produce:** una estructura de índice en memoria + su forma serializada en caché.

2. **Index Store (Almacén / caché)**
   - **Qué hace:** persiste el índice en disco en `.sens/` y hace **reindexado incremental**: al consultar, compara la fecha de modificación (mtime) de los archivos y reindexa solo los que cambiaron.
   - **Depende de:** el Indexer.
   - **Produce:** un índice siempre fresco sin coste de reconstruir todo.

3. **Query Engine (Motor de consultas)**
   - **Qué hace:** responde las consultas sobre el índice (ver sección 6).
   - **Depende de:** el Index Store.

4. **MCP Server (Servidor MCP)**
   - **Qué hace:** expone el Query Engine como herramientas MCP a Claude Code.
   - **Depende de:** el Query Engine y el SDK oficial de MCP.

5. **CLI**
   - **Qué hace:** comandos para humanos con salida con formato/colores (ver sección 7).
   - **Depende de:** el Query Engine.

6. **HTML Report Generator (Generador de reporte)**
   - **Qué hace:** renderiza el índice + código muerto + ahorro estimado en un archivo HTML **estático y autocontenido** que se abre en el navegador.
   - **Depende de:** el Query Engine.

```
                 ┌──────────────┐
  archivos  ───▶ │  Indexer     │
                 └──────┬───────┘
                        ▼
                 ┌──────────────┐   caché en disco (.sens/)
                 │ Index Store  │◀──── reindexa solo lo que cambia (mtime)
                 └──────┬───────┘
                        ▼
                 ┌──────────────┐
                 │ Query Engine │
                 └──┬───────┬───┘
          ┌─────────┘       └─────────┐
          ▼                           ▼
   ┌────────────┐              ┌───────────────┐
   │ MCP Server │              │ CLI + Reporte │
   │ (→ Claude) │              │  (→ humano)   │
   └────────────┘              └───────────────┘
```

## 6. Herramientas MCP (contrato)

| Herramienta | Entrada | Salida | Sustituye a |
|---|---|---|---|
| `project_map` | (opcional: subcarpeta) | Árbol de carpetas + una línea por archivo (qué hace) + sus exports/piezas clave | Leer ~20 archivos para orientarse |
| `find_symbol` | nombre del símbolo | Archivo, línea y firma de la definición | `grep` |
| `who_uses` | nombre del símbolo | Lista de sitios (archivo:línea) que lo usan | `grep` + lecturas |
| `file_outline` | ruta de archivo | Firmas de sus símbolos (sin cuerpos) | Leer el archivo entero |
| `already_exists` | nombre o palabras clave de una funcionalidad | Coincidencias existentes que podrían reutilizarse (búsqueda por nombre/símbolo, no semántica en v1) | Duplicar sin querer |
| `dead_code` | (opcional: subcarpeta) | Símbolos/exports con cero usos (candidatos) | — |

Notas:
- Las salidas se diseñan para ser **compactas** (el valor es que Claude pague pocos tokens por respuesta).
- Los nombres de las herramientas en el código serán en inglés (`project_map`, etc.).

## 7. Comandos CLI (para humanos)

- `sens index` — construye/actualiza el índice.
- `sens map` — imprime el mapa del proyecto con formato.
- `sens dead-code` — imprime los candidatos a código muerto con formato/colores.
- `sens report` — genera el **reporte HTML** (mapa + código muerto + ahorro estimado) y muestra su ruta.

## 8. Detección de código muerto

**Mecanismo:** con el grafo de referencias, un símbolo con **cero usos** (y que no sea un punto de entrada) es **candidato** a código muerto.

**Honestidad y falsos positivos (crítico para la confianza):**
- Nunca se reporta como "borrar seguro", solo como **candidato**.
- Casos que hay que respetar para no dar falsos positivos:
  - **Auto-imports de frameworks** (p. ej. componentes de **Nuxt/Vue** que se registran por convención).
  - Archivos de **test**.
  - **API pública** de una librería (exports pensados para consumidores externos).
  - Uso dinámico (por string / reflexión) — no siempre detectable.
- Habrá una lista de **excepciones** configurable (patrones a ignorar y puntos de entrada declarados).

## 9. Reporte HTML

- Un único archivo **estático y autocontenido** (sin servidor, sin framework en vivo).
- Contenido: mapa del proyecto, lista de código muerto y **ahorro estimado** (p. ej. comparación de tokens de "leer todo" vs "consultar Sens").
- Objetivo secundario explícito: que sea **bonito y screenshot-friendly** para el README de GitHub.

## 10. Decisiones técnicas

- **Lenguaje de implementación:** TypeScript.
- **MCP:** SDK oficial de Model Context Protocol.
- **Distribución:** servidor MCP + CLI ejecutable vía `npx`; instalable como plugin/skill de Claude Code. Nombre de paquete: `sens-mcp` o scoped.
- **Lenguaje soportado en v1:** **JS/TS primero.** Razones: (a) ecosistema del autor y el más común en Claude Code; (b) la detección de código muerto y el `already_exists` requieren **resolver imports/exports de verdad**, y JS/TS tiene herramientas maduras para eso.
- **Frescura del índice:** caché en `.sens/`, reindexado incremental por mtime al consultar (sin necesidad de hooks ni watchers en v1).
- **Parsing:** analizador real de JS/TS que resuelva módulos (decisión concreta de librería —p. ej. la API del compilador de TS, `ts-morph`, o tree-sitter + resolución de módulos— se deja para el plan de implementación).

## 11. Alcance

**Dentro de v1:** índice + caché incremental + 6 herramientas MCP + CLI + reporte HTML + soporte JS/TS.

**Fuera de v1 (hoja de ruta):**
1. **Hook de enforcement** (PostToolUse) que avise/bloquee cuando una edición introduce código muerto o un duplicado.
2. **Búsqueda semántica** (embeddings) para `already_exists` y **detección de duplicados** "parecidos" (fuzzy / semántica).
3. **Métricas de complejidad** / hotspots.
4. **Más lenguajes** vía tree-sitter (Python, Go, Rust…).
5. **Dashboard web en vivo** con grafo interactivo.

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Falsos positivos en código muerto (dañan la confianza) | Reportar solo "candidatos" + lista de excepciones + respetar auto-imports/tests/API pública |
| El índice se queda obsoleto | Reindexado incremental por mtime en cada consulta |
| "Otro repomix/knip más" | Posicionamiento claro: la novedad es el **MCP consultable** + `already_exists` + reporte unificado, no el análisis en sí |
| Nombre `sens` ocupado en npm | Publicar como `sens-mcp`/scoped; la marca sigue siendo "Sens" |
| Resolución de imports JS/TS es compleja | Empezar solo con JS/TS y apoyarse en herramientas maduras del ecosistema |

## 13. Criterios de éxito (v1)

- En un proyecto JS/TS real, Claude resuelve una tarea típica **consultando Sens** y **leyendo menos archivos completos** que sin él (ahorro de tokens medible y demostrable).
- `sens dead-code` encuentra código muerto real en un repo real **sin falsos positivos evidentes** en los casos comunes.
- `sens report` produce un HTML presentable para el README.
- Instalación y conexión a Claude Code en pocos pasos.
