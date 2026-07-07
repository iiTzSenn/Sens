<p align="center">
  <img src="docs/banner.svg" alt="Sens — a project index for Claude Code" width="860">
</p>

<p align="center">
  <a href="#license"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-1a7f47?style=flat-square"></a>
  <img alt="Built for Claude Code" src="https://img.shields.io/badge/built_for-Claude_Code-4f7cff?style=flat-square">
  <img alt="MCP server" src="https://img.shields.io/badge/MCP-server-7a5cff?style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Status" src="https://img.shields.io/badge/status-early_development-e0a33d?style=flat-square">
</p>

<p align="center">
  <b>Let the model <i>query</i> your codebase instead of reading it all.</b><br>
  Fewer tokens, cleaner context, and a heads-up when code already exists or is dead.
</p>

---

## Why Sens?

If you use Claude Code on a **subscription**, your pain isn't a per-token bill — it's the **usage limit** and the **context window filling up**. Every time the agent opens 20 files just to orient itself, it burns your quota and bloats the context (which then compacts and quietly loses memory).

Sens keeps a compact **index** of your project and serves it to Claude over **MCP**, so the model asks focused questions instead of reading everything:

> *"where is `login`?"* · *"who uses it?"* · *"does something like this already exist?"* · *"what's dead code here?"*

One engine, two payoffs:

- 🪙 **Fewer tokens / cleaner context** → your subscription lasts longer and long sessions stay sharp.
- 🧹 **Cleaner code** → reuse what already exists instead of duplicating, and surface dead code.

> [!NOTE]
> Sens is **not** a "write-less" rules engine (that's what [ponytail](https://github.com/DietrichGebert/ponytail) does well). Sens is the missing piece underneath: the **project knowledge** that makes "reuse what exists" actually work. They're complementary.

## Contents

- [Quick start](#quick-start) · [What Claude gets](#what-claude-gets-mcp-tools) · [Slash commands](#slash-commands) · [CLI](#cli) · [Dashboard](#dashboard)
- [Does it actually help?](#does-it-actually-help) · [How it works](#how-it-works) · [Configuration](#configuration) · [Dead code](#dead-code--read-this) · [Roadmap](#roadmap) · [License](#license)

## Quick start

Add Sens as an MCP server. In your project's `.mcp.json` (or Claude Code's MCP config):

```json
{
  "mcpServers": {
    "sens": {
      "command": "npx",
      "args": ["-y", "sens-mcp", "mcp"]
    }
  }
}
```

Or register it once for **every** project:

```bash
claude mcp add sens -s user -- npx -y sens-mcp mcp
```

That's it. Claude Code launches Sens on demand — no per-project install, no manual server to run. Then just ask Claude naturally: *"use sens to map this project"*, *"any dead code? check with sens"*.

## What Claude gets (MCP tools)

| Tool | What it does | Replaces |
| --- | --- | --- |
| `project_map` | A one-screen map of the repo with each file's exports | Reading many files to orient |
| `find_symbol` | Where a symbol is defined (file:line + signature) | `grep` |
| `who_uses` | Every place a symbol is used | `grep` + reads |
| `file_outline` | A file's signatures, without its bodies | Reading the whole file |
| `already_exists` | Whether something matching keywords already exists | Duplicating by accident |
| `dead_code` | Unused symbols / exports (candidates) | — |

## Slash commands

Sens also registers prompts, so it shows up in Claude Code's `/` menu:

| Command | Does |
| --- | --- |
| `/sens map` | Compact project map |
| `/sens dead-code` | List dead-code candidates |
| `/sens find <name>` | Locate a symbol |
| `/sens exists <keywords>` | Check for existing code before writing |
| `/sens dashboard` | Open the web dashboard (graph) |

## CLI

You can also drive Sens yourself:

```bash
npx sens-mcp index          # build/update the index (cached by file mtime)
npx sens-mcp map [subdir]   # compact project map
npx sens-mcp find <name>    # where a symbol is defined
npx sens-mcp who <name>     # where a symbol is used
npx sens-mcp outline <file> # a file's signatures, no bodies
npx sens-mcp exists <kw...> # does something like this already exist?
npx sens-mcp dead-code      # unused symbols (candidates)
npx sens-mcp report         # self-contained HTML report → .sens/report.html
npx sens-mcp dashboard      # interactive web dashboard
```

> Installed globally (`npm i -g sens-mcp`) the command is just `sens <command>`.

## Dashboard

`sens dashboard` starts a local web UI (default `http://localhost:4319`):

- an **interactive graph** of your project — files as nodes, imports as edges (drag, click a node to see its symbols);
- live **stats** and a clickable **dead-code** list;
- a symbol **search**;
- a one-click **Connect to Claude Code** (writes `.mcp.json`) and a **Rebuild index** button.

```bash
npx sens-mcp dashboard --root . --port 4319   # --no-open to skip opening the browser
```

<p align="center"><i>Nodes are files; blue = has exports, gray = internal, red = has dead code.</i></p>

## Does it actually help?

Early numbers from dogfooding Sens on a real Vite + React app and on Sens itself:

| Metric | Result | How it's measured |
| --- | --- | --- |
| Tokens to **orient** in a project | **~95% fewer** *(est.)* | Project map ≈ 450 tokens vs ≈ 9,000 to read the source tree |
| **Re-index** when nothing changed | **~37× faster** | 975 ms cold build → 26 ms from cache |
| **Duplication** | caught *before* writing | `already_exists` surfaces existing code |
| **Dead code** | found, with 0 false positives on i18n | after the object-shorthand reference fix |

> These are early, estimated figures from real usage — not a formal benchmark suite yet. Rigorous, reproducible benchmarks are on the [roadmap](#roadmap).

## How it works

TypeScript + [ts-morph](https://ts-morph.com). Sens walks your source (respecting `.gitignore`), extracts top-level symbols with compact signatures, and resolves cross-file references in a single pass. The index is cached in `.sens/index.json` and only rebuilt when file mtimes change; a schema version invalidates stale caches across upgrades.

**JS/TS today** (`.ts .tsx .js .jsx .mts .cts`). More languages via tree-sitter are on the roadmap.

## Configuration

Optional `sens.config.json` at your project root:

```json
{
  "ignore": ["**/generated/**"],
  "entryPoints": ["src/public-api.ts"]
}
```

- **`ignore`** — extra globs to skip (on top of `.gitignore`, `node_modules`, `dist`).
- **`entryPoints`** — files whose exports are your public API, so they're never flagged as dead. `**/index.*` files are treated as entry points by default.

## Dead code — read this

Dead-code results are **candidates**, not certainties. Sens can't see:

- dynamic usage (string-based access, reflection);
- framework "magic" (e.g. Vue/Nuxt auto-imported components — SFC support is on the roadmap);
- a public API meant for external consumers (use `entryPoints`).

Test files count as usage sources but are never themselves reported as dead. **Verify before deleting.**

## Roadmap

- [ ] Enforcement hook (warn/block when an edit introduces dead code or a duplicate)
- [ ] Semantic `already_exists` (embeddings) + near-duplicate detection
- [ ] More languages via tree-sitter; Vue/Svelte SFCs
- [ ] Dashboard: symbol-level graph, live file watching
- [ ] A reproducible benchmark suite

## Contributing

Issues and PRs welcome. To develop locally:

```bash
npm install
npm run build      # bundle to dist/
npm test           # vitest
npm run typecheck
```

`npm link` makes `sens` a global command pointing at your local build.

## License

[MIT](LICENSE) — do what you want, just keep the copyright notice. See the note below on why.
