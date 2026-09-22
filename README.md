<p align="center">
  <img src="docs/banner.svg" alt="sens — a project index for Claude Code" width="860">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/sens-mcp"><img alt="npm version" src="https://img.shields.io/npm/v/sens-mcp?style=flat-square&color=cb3837&logo=npm"></a>
  <a href="#license"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-111313?style=flat-square"></a>
  <img alt="Built for Claude Code" src="https://img.shields.io/badge/built_for-Claude_Code-111313?style=flat-square">
  <img alt="MCP server" src="https://img.shields.io/badge/MCP-server-111313?style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Status" src="https://img.shields.io/badge/status-early_development-111313?style=flat-square">
</p>

<p align="center">
  <b>Let the model <i>query</i> your codebase instead of reading it all.</b><br>
  Fewer tokens, cleaner context, and a heads-up when code already exists or is dead.
</p>

<p align="center">
  <sub><b>WORKS WITH</b></sub>
</p>
<p align="center">
  <img src="docs/agents/claude.svg" alt="Claude Code" title="Claude Code" height="46">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/agents/codex.svg" alt="Codex" title="Codex" height="46">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/agents/copilot.svg" alt="GitHub Copilot" title="GitHub Copilot" height="46">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="docs/agents/cursor.svg" alt="Cursor" title="Cursor" height="46">
</p>
<p align="center">
  <img alt="Windsurf" src="https://img.shields.io/badge/Windsurf-0c0d0d?style=for-the-badge&logo=windsurf&logoColor=58C4A6">
  <img alt="Gemini CLI" src="https://img.shields.io/badge/Gemini_CLI-0c0d0d?style=for-the-badge&logo=googlegemini&logoColor=8AB4F8">
  <img alt="Zed" src="https://img.shields.io/badge/Zed-0c0d0d?style=for-the-badge&logo=zedindustries&logoColor=white">
  <img alt="Cline" src="https://img.shields.io/badge/Cline-0c0d0d?style=for-the-badge&logo=cline&logoColor=white">
  <img alt="Continue" src="https://img.shields.io/badge/Continue-0c0d0d?style=for-the-badge&logo=continue&logoColor=white">
</p>
<p align="center">
  <sub>Claude&nbsp;Code&nbsp;&nbsp;·&nbsp;&nbsp;Codex&nbsp;&nbsp;·&nbsp;&nbsp;GitHub&nbsp;Copilot&nbsp;&nbsp;·&nbsp;&nbsp;Cursor&nbsp;&nbsp;·&nbsp;&nbsp;Windsurf&nbsp;&nbsp;·&nbsp;&nbsp;Gemini&nbsp;CLI&nbsp;&nbsp;·&nbsp;&nbsp;Zed&nbsp;&nbsp;·&nbsp;&nbsp;Cline&nbsp;&nbsp;·&nbsp;&nbsp;Continue&nbsp;&nbsp;·&nbsp;&nbsp;any&nbsp;MCP&nbsp;client</sub>
</p>

---

## Why Sens?

If you use Claude Code on a **subscription**, your pain isn't a per-token bill — it's the **usage limit** and the **context window filling up**. Every time the agent opens 20 files just to orient itself, it burns your quota and bloats the context (which then compacts and quietly loses memory).

Sens keeps a compact **index** of your project and serves it to Claude — through an **MCP** server, or a **hook** that answers the model's searches before they run — so the model asks focused questions instead of reading everything:

> *"where is `login`?"* · *"who uses it?"* · *"does something like this already exist?"* · *"what's dead code here?"*

One engine, two payoffs:

- 🪙 **Fewer tokens / cleaner context** → your subscription lasts longer and long sessions stay sharp.
- 🧹 **Cleaner code** → reuse what already exists instead of duplicating, and surface dead code.

> [!NOTE]
> Sens is **not** a "write-less" rules engine (that's what [ponytail](https://github.com/DietrichGebert/ponytail) does well). Sens is the missing piece underneath: the **project knowledge** that makes "reuse what exists" actually work. They're complementary.

## Contents

- [Quick start](#quick-start) · [What Claude gets](#what-claude-gets-mcp-tools) · [Slash commands](#slash-commands) · [CLI](#cli)
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

Claude Code launches Sens on demand — no per-project install, no manual server to run. The index builds itself on the first query; `sens index` warms it up front.

Then work normally and ask Claude naturally (*"any dead code? check with sens"*).

## What Claude gets

The same set of operations, whether Claude runs them as `sens` commands or as MCP tools:

| Operation | What it does | Replaces |
| --- | --- | --- |
| `project_map` | A one-screen map of the repo with each file's exports | Reading many files to orient |
| `find_symbol` | Where a symbol is defined (file:line + signature) | `grep` |
| `who_uses` | Every place a symbol is used | `grep` + reads |
| `file_outline` | A file's signatures, without its bodies | Reading the whole file |
| `already_exists` | Whether something matching keywords already exists | Duplicating by accident |
| `explain_symbol` | A symbol's callers and callees (call-graph neighborhood) | Reading files to trace a function |
| `symbol_path` | The shortest chain of calls connecting two symbols | Manually following the call chain |
| `dead_code` | Unused symbols / exports (candidates) | — |
| `file_dependencies` | What a file imports and what imports it (import graph) | Grepping for imports across the project |

## Working rules

Sens's MCP server also hands Claude a short set of **working rules** it follows when writing or changing code — reuse what exists instead of duplicating, keep code minimal but maintainable, and leave nothing orphaned — each tied to the tool that lets it *verify* the rule (`already_exists`/`find_symbol` before writing, `dead_code` before finishing, `who_uses` before a rename). The rules are **composable modules** (search-first, minimal, no-orphans, optimization, plus opt-in error-handling and testing). Enable/disable modules or add your own in `sens.config.json`, or see their state with `sens rules --list`. Run `sens rules` to print the active set, or `sens rules --write` to drop a `SENS_RULES.md` you can reference from your `CLAUDE.md` / `AGENTS.md`.

## Slash commands

Sens also registers prompts, so it shows up in Claude Code's `/` menu:

| Command | Does |
| --- | --- |
| `/sens map` | Compact project map |
| `/sens dead-code` | List dead-code candidates |
| `/sens find <name>` | Locate a symbol |
| `/sens exists <keywords>` | Check for existing code before writing |
| `/sens rules` | Load the working rules and follow them |

## CLI

You can also drive Sens yourself:

```bash
npx sens-mcp index          # build/update the index (cached by file mtime)
npx sens-mcp map [subdir]   # compact project map
npx sens-mcp find <name>    # where a symbol is defined
npx sens-mcp who <name>     # where a symbol is used (--full for every call site)
npx sens-mcp explain <name> # a symbol's callers and callees (call graph)
npx sens-mcp path <a> <b>   # shortest chain of calls between two symbols
npx sens-mcp outline <file> # a file's signatures, no bodies
npx sens-mcp exists <kw...> # does something like this already exist?
npx sens-mcp dead-code      # unused symbols (candidates)
npx sens-mcp deps <file>    # what a file imports and what imports it
npx sens-mcp rules          # print active rules (--list for module states, --write to save)
```

> Installed globally (`npm i -g sens-mcp`) the command is just `sens <command>`.

Every command shares one modern look — a braille spinner while indexing, a consistent `sens › <command>` header, and color that *means* something (green ok, red error, yellow warning, gray for paths/counts/timings). Errors stay a single clear line; add `--verbose` for the full stack trace. This styling is **terminal-only**: what the model reads over the MCP server or the hook stays plain text, so nothing here bloats its context.

## Does it actually help?

A reproducible benchmark suite ([`bench/run.ts`](bench/run.ts)) measures this on Sens's own repo and fixtures — run it yourself with `npm run bench`. No estimates, no anecdotes: every number below comes straight from that script.

| Metric | Result | How it's measured |
| --- | --- | --- |
| Size to **orient** in a project | **~97% fewer characters** | `project_map` output vs. concatenating every file in `src/` |
| **Re-index** when nothing changed | **~100\u2013125\u00d7 faster** *(varies by run/hardware)* | median cold build (`force: true`) vs. median cached read, 5 runs each |
| **Duplication** | caught *before* writing | `already_exists("subtract two numbers")` surfaces the existing `subtract` |
| **Dead code** false positives | **0 out of 8** labeled symbols | against fixtures with known used / dead / object-shorthand-referenced symbols |

> Re-run `npm run bench` on your own machine or project to reproduce (or challenge) these numbers. Re-index speed varies with CPU and disk, so treat it as a range, not a fixed multiplier.

## How it works

Pluggable per-language parsers behind one language-agnostic index. Sens walks your source (respecting `.gitignore`), extracts top-level symbols with compact signatures, resolves references, and caches the result in `.sens/index.json` — only rebuilt when file mtimes change; a schema version invalidates stale caches across upgrades.

**Languages:**

- **JavaScript / TypeScript** (`.ts .tsx .js .jsx .mts .cts`) via [ts-morph](https://ts-morph.com) — cross-file references are resolved *semantically* (it follows your imports).
- **Python, Go, Rust, Java, C#, C, C++, PHP, Ruby, Kotlin** via [tree-sitter](https://tree-sitter.github.io/) — functions, classes/structs, methods, constants, and an import graph per file.

Everything lands in one language-agnostic index, so a mixed repo (e.g. a TS frontend + a Python or Go backend) is indexed as a single project. For the tree-sitter languages, cross-file references are resolved *by name* — the best a syntax-only parser can do without whole-program type inference — so `who_uses` / `dead-code` are slightly more approximate than for JS/TS: they over-count rather than miss, which keeps dead-code candidates conservative. Adding a language is a small self-contained parser (`src/indexer/languages/`); more are on the roadmap.

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

Dead-code results are **candidates**, not certainties — but they're now ranked so
you know how far to trust each one. Sens reports everything **unreachable** from an
entry point (including *dead islands* — clusters that only reference each other — and
whole dead files), tiered by confidence:

- 🟢 **HIGH** — internal, no references anywhere. Safe to remove after a glance.
- 🟡 **MEDIUM** — internal, reached only from other dead code. Remove the cluster together.
- 🔴 **LOW** — an export (maybe public API) or a method (maybe dynamic dispatch). **Verify first.**

Before reporting, Sens also greps your non-source files (JSON/config/templates) and
flags any candidate whose name shows up there as a possible **reflective use**. Entry
points are auto-detected (`package.json` across a monorepo; `main`/`init`/framework
annotations per language), and test files count as usage but are never reported as dead.
It still can't see every dynamic/reflective path, so: **verify LOW candidates before deleting.**

## Roadmap

- [ ] Enforcement hook (warn/block when an edit introduces dead code or a duplicate)
- [ ] Semantic `already_exists` (embeddings) + near-duplicate detection
- [x] Per-language dead-code accuracy across all tree-sitter languages
- [ ] Vue/Svelte SFC support; more languages via tree-sitter
- [x] A reproducible benchmark suite (`npm run bench`)

## Contributing

Issues and PRs welcome. To develop locally:

```bash
npm install
npm run build      # bundle to dist/
npm test           # vitest
npm run typecheck
npm run brand      # regenerate logo, icons and banner
```

`npm link` makes `sens` a global command pointing at your local build.

Anything visual — interface, asset, terminal output, marketing — follows
[the Sens visual identity](docs/brand/identity.md). Colours live in
`src/brand/tokens.ts` and the mark's geometry in `src/brand/mark.ts`; import the
token instead of retyping a hex, and edit the generator rather than the
generated asset.

## License

[MIT](LICENSE) — do what you want, just keep the copyright notice. See the note below on why.
