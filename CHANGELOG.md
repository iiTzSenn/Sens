# Changelog

All notable changes to `sens-mcp` are documented here. This project follows
[Semantic Versioning](https://semver.org/): `patch` = fix, `minor` = feature,
`major` = breaking change.

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
