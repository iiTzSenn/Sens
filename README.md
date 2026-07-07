# Sens

> A project index for [Claude Code](https://www.anthropic.com/claude-code) — let the model **query** your codebase instead of reading it all.

**Status: early development (v1).**

## Why

If you use Claude Code on a **subscription**, your pain isn't a per-token bill — it's the **usage limit** and the **context window filling up**. Every time the agent opens 20 files just to orient itself, it burns your quota and bloats the context (which then compacts and loses memory).

Sens keeps a compact **index** of your project and serves it to Claude over **MCP**, so the model asks focused questions — *"where is `login`?"*, *"who uses it?"*, *"does something like this already exist?"* — and only reads what it truly needs.

Two payoffs from one engine:

- **Fewer tokens / cleaner context** → your subscription lasts longer, long sessions stay sharp.
- **Cleaner code** → reuse what already exists instead of duplicating, and surface **dead code**.

> Sens is not a "write-less" rules engine (that's what [ponytail](https://github.com/DietrichGebert/ponytail) does well). Sens is the missing piece underneath: the **project knowledge** that makes "reuse what exists" actually work. They're complementary.

## Install in Claude Code

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

That's it — Claude Code will launch Sens on demand and gain six tools:

| Tool | What Claude gets |
| --- | --- |
| `project_map` | A one-screen map of the repo instead of reading many files |
| `find_symbol` | Where a symbol is defined (file:line + signature) |
| `who_uses` | Every place a symbol is used, without grepping |
| `file_outline` | A file's signatures without its bodies |
| `already_exists` | Whether something matching some keywords already exists (reuse over duplicate) |
| `dead_code` | Unused symbols/exports (candidates) |

## CLI

You can also use Sens yourself:

```bash
npx sens-mcp index          # build/update the index (cached by file mtime)
npx sens-mcp map [subdir]   # compact project map
npx sens-mcp find <name>    # where a symbol is defined
npx sens-mcp who <name>     # where a symbol is used
npx sens-mcp outline <file> # a file's signatures, no bodies
npx sens-mcp exists <kw...> # does something like this already exist?
npx sens-mcp dead-code      # unused symbols (candidates)
npx sens-mcp report         # write a self-contained HTML report to .sens/report.html
```

> The `sens` bin is installed under both `sens` and `sens-mcp`. If you install globally (`npm i -g sens-mcp`), just run `sens <command>`.

## The HTML report

`sens report` generates a single self-contained `.sens/report.html` — project stats, the dead-code table, the project map, and an estimated token saving. Open it in any browser; nice for sharing.

## Configuration (optional)

Create `sens.config.json` at your project root:

```json
{
  "ignore": ["**/generated/**"],
  "entryPoints": ["src/public-api.ts"]
}
```

- **`ignore`** — extra globs to skip when indexing (on top of `.gitignore`, `node_modules`, `dist`).
- **`entryPoints`** — files whose exports are your public API, so they are never flagged as dead. `**/index.*` files are treated as entry points by default.

## Dead code — read this

Dead-code results are **candidates**, not certainties. Sens can't see:

- Dynamic usage (string-based access, reflection).
- Framework "magic" (e.g. Vue/Nuxt auto-imported components — SFC support is on the roadmap).
- A public API meant for external consumers (use `entryPoints`).

Test files count as usage sources but are never themselves reported as dead. **Verify before deleting.**

## How it works

TypeScript + [ts-morph](https://ts-morph.com). Sens walks your source (respecting `.gitignore`), extracts top-level symbols with compact signatures, and resolves cross-file references in a single pass. The index is cached in `.sens/index.json` and only rebuilt when file mtimes change. **JS/TS today** (`.ts .tsx .js .jsx .mts .cts`); more languages via tree-sitter are on the roadmap.

## Roadmap

- Enforcement hook (warn/block when an edit introduces dead code or a duplicate)
- Semantic `already_exists` (embeddings) + near-duplicate detection
- More languages (tree-sitter), Vue/Svelte SFCs
- Live web dashboard

## Docs

- [Design spec](docs/specs/2026-07-07-sens-design.md)
- [Implementation plan](docs/plans/2026-07-07-sens-v1-implementation-plan.md)

## License

MIT © Sofia
