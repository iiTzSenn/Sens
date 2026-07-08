# Changelog

All notable changes to `sens-mcp` are documented here. This project follows
[Semantic Versioning](https://semver.org/): `patch` = fix, `minor` = feature,
`major` = breaking change.

## [0.5.0] — 2026-07-08

### Added
- **`sens init`** — one command to set sens up in a project: builds the index,
  installs the skill into `.claude/skills/sens/`, and wires the `PreToolUse` hook
  into `.claude/settings.json` (merging, never clobbering existing settings). This
  is the recommended setup path; the MCP server stays available for hosts that
  only speak MCP.
- **Skill** — sens now ships as a Claude Code skill (`sens skill` prints it, or
  `--write` installs it). Unlike the always-loaded MCP tool schemas, a skill's
  guidance only enters context when relevant, so it costs no tokens on turns that
  don't touch code. It is composed from the same working rules as `sens rules`.

### Improved
- **The hook now answers, not just nudges.** When the model is about to grep for a
  symbol sens knows, the hook substitutes the grep and returns the full `who_uses`
  result; a Read of an indexed file gets that file's outline injected; anything
  sens can't answer falls back to a one-line reminder.
- **One shared query path** (`runQuery`) now backs the CLI, the MCP server and the
  hook, so usage logging and output formatting are identical across all three —
  and `sens usage` records CLI- and hook-driven calls too, not only MCP.

### Fixed
- `sens --version` reported a hard-coded `0.0.1` regardless of the real version; it
  now derives from `package.json` at build time and tracks `npm version`.

## [0.4.0] — 2026-07-08

### Added
- **Symbol-level call graph** — references now record their *caller* (the symbol
  whose body contains each use), turning the flat usage list into a real
  call/reference graph. Two new queries expose it: `explain` (a symbol's callers
  and callees in one call) and `path` (the shortest chain of calls connecting two
  symbols). Available as CLI commands (`sens explain`, `sens path`) and MCP tools
  (`explain_symbol`, `symbol_path`); `who_uses` now also shows which symbol each
  use sits in.
- **Nudge hook** — `sens hook` is a `PreToolUse` hook that gently reminds the
  model to reach for sens (`find_symbol`, `file_outline`, `explain_symbol`, …)
  before it greps or reads whole files. Fires at most once per session per tool
  and stays silent on non-source files.
- **Graph export** — the dashboard can export the dependency graph to GEXF,
  GraphML, DOT, JSON and a CSV edge list via `/api/export`, so it opens in Gephi,
  yEd, Cytoscape or Graphviz.

### Improved
- **Faster queries** — the query engine builds its name/file/id lookups, the
  import adjacency and the call graph once up front (O(1) lookups), and the engine
  is memoized per project so repeated MCP calls skip re-reading and re-parsing the
  index from disk.

## [0.3.0] — 2026-07-08

### Added
- **Dashboard internationalization** — a language selector in the top bar with
  25 locales, including right-to-left (Arabic, Hebrew, Persian). The UI
  auto-detects the browser language on first load and remembers the choice.
- **A logo** — a constellation mark (the code graph the tool builds), shipped as
  SVG and PNG variants under `assets/`, an SVG favicon, and the brand mark in the
  dashboard.

### Improved
- **Graph links at every depth** — drilling into a folder no longer hides how its
  files connect: dependencies that leave the current level are drawn as external
  boundary nodes, so deep views keep their connecting lines instead of becoming
  loose dots.
- **Dashboard polish** — the light/dark toggle animates the sun/moon icon and
  cross-fades the whole UI smoothly, the language globe spins on use, and the
  connection status dots are now static (no pulsing).

## [0.2.0] — 2026-07-07

### Added
- **10 more languages** via tree-sitter: Python, Go, Rust, Java, C#, C, C++, PHP,
  Ruby and Kotlin. A mixed repo (e.g. a TS frontend + a Python/Go backend) is
  indexed as a single project. Adding a language is a small self-contained parser
  under `src/indexer/languages/`.
- **Working rules** the model follows (reuse over duplicate, no orphan code,
  minimal but maintainable), each tied to the tool that verifies it. Delivered
  automatically over MCP, printable with `sens rules`, and injectable via the
  `/sens rules` prompt.
- **Usage log** — every MCP tool call is recorded to `.sens/usage.jsonl`; the new
  `sens usage` command shows which tools the model actually called.

### Improved
- `dead_code` no longer flags code that *is* used but is invisible to static
  analysis: dynamic `import("./x")`, `export * from` barrels, named re-exports,
  and string / reflective access (`obj["name"]`, registries).
- Lazy-load `ts-morph` and the heavy CLI-only modules so a project (or command)
  that doesn't need them never pays for them.

### Notes
- **Swift** is intentionally excluded: its tree-sitter grammar crashes Node's WASM
  teardown. Every other listed language is fully supported.
- The on-disk index schema was bumped; caches rebuild automatically after upgrade.

## [0.1.0] — 2026-07-07

### Added
- Refactored the indexer into **pluggable per-language parsers** behind one
  language-agnostic index.
- **Python** support via tree-sitter (functions, classes, methods, module
  constants, import graph).
- Clear warning when a project has no files in a supported language.
