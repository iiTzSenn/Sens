<p align="center">
  <img src="docs/banner.svg" alt="sens — understand more, read less" width="860">
</p>

<p align="center">
  <a href="#license"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-111313?style=flat-square"></a>
  <img alt="Windows" src="https://img.shields.io/badge/Windows-111313?style=flat-square&logo=windows&logoColor=white">
  <img alt="Rust" src="https://img.shields.io/badge/Rust-111313?style=flat-square&logo=rust&logoColor=white">
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-111313?style=flat-square&logo=tauri&logoColor=FFC131">
  <img alt="Status" src="https://img.shields.io/badge/status-early_development-111313?style=flat-square">
</p>

<p align="center">
  <b>A desktop editor where the model has to get past the gates.</b><br>
  It indexes your project, writes the smallest patch that does the job, and refuses its own work when the patch duplicates, orphans, bloats or breaks something.
</p>

<p align="center">
  <img src="docs/app-code.png" alt="The Sens desktop app: project tree and code pane" width="900">
</p>

> [!NOTE]
> Sens is in early development. There is no release to download yet — you build it yourself (see [Install](#install)). The packaged installer is Windows-only today; other platforms are untested. The interface is in Spanish.

---

## What it is

Most coding agents are generous. Ask for a field and you get a helper, a wrapper, a second way to do something the project already did, and four comments explaining it. The code works, the repo rots.

Sens is the opposite bet. One engine, in Rust, that knows your codebase because it indexes it, and that judges every patch **before** it reaches your files. The model proposes. The gates decide.

What you get out of it is not speed. It is that the diff you read at the end is one you would have written.

## How a run goes

1. **You open a folder.** Sens indexes it — symbols, references, imports, entry points — and tells you how fresh the index is and which gates are armed.
2. **You pick who writes.** Claude Code on your subscription, with any model it offers you.
3. **You say what to do.** The task goes out with a briefing built from the index, not from the whole repo.
4. **The gates judge the patch.** Duplication, orphans, growth and comments, all before a single byte is written to disk.
5. **The patch lands as a transaction and the suite runs.** Every original is saved and verified first; if the tests go red, the whole thing rolls back byte for byte and the model is told what broke. Two repairs, then it gives up rather than insist.
6. **A second model shortens it.** Same behaviour, fewer lines, or it keeps the original.
7. **The index updates** with only what changed.

## The gates

Each one can pass, abstain or stop. A stop means the patch never touches your files.

| Gate | Rule | Stops when |
| --- | --- | --- |
| **G1** | duplication | The patch adds something the index says already exists. It names it. |
| **G2** | orphans | The patch leaves code that nothing reaches, or strands code that used to be reached. |
| **G3** | growth | The patch is over budget — 40 net lines — for what you asked. |
| **G4** | tests | Your suite fails. Auto-detected: `cargo test`, `go test`, `npm test` or `pytest`. |
| **G5** | comments | The patch writes comments instead of naming things properly. |

Above them all there is a **seal**: an FNV hash of every gate's fingerprint, shown in the status bar. If the seal changes, the rules changed — and you can see it without reading any config.

## Who writes

| Provider | What it uses | Models |
| --- | --- | --- |
| **Claude Code** | your subscription, through the CLI | discovered, not hard-coded |

Sens never ships a model list. It asks Claude Code which model answers for each family — Fable, Opus, Sonnet, Haiku — so a new release shows up on its own. **Refresh models** asks again; **Edit models** hides the ones you never want to see or use.

Every run uses the chosen model twice: once to write, and once to put the patch on a diet afterwards.

<p align="center">
  <img src="docs/app-models.png" alt="Picking the model" width="900">
</p>

## The index underneath

Sens walks your source respecting `.gitignore`, extracts top-level symbols with compact signatures, resolves references and imports, and caches the result in `.sens/`. Only what changed gets rebuilt.

- **Go, Python, Rust, Java, C#, C, C++, PHP, Ruby, Kotlin** — indexed natively, in Rust, via [tree-sitter](https://tree-sitter.github.io/). References resolve by name, which over-counts rather than misses, so the orphan gate stays conservative.
- **JavaScript / TypeScript** — resolved semantically with [ts-morph](https://ts-morph.com), which follows your imports properly. This path still runs through Node, so a JS/TS project needs Node 18+ on your machine.

A mixed repo is one project: a TypeScript frontend and a Go backend land in the same index.

## Install

There is no signed installer to download yet. To build it:

```bash
npm ci
npm run app:dev
```

That launches the app against your local sources. To produce the Windows installer instead:

```bash
npm run app:installer
```

It will refuse to build an unsigned one by accident. Give it a certificate from the Windows store with `SENS_SIGN_THUMBPRINT`, your own signing tool with `SENS_SIGN_COMMAND` (which must contain `%1`), or pass `--unsigned` when you know that is what you want. macOS needs notarization, which is a different certificate and a different story — not done yet.

## Develop

```bash
npm install
npm test                 # vitest, the indexer side
npm run test:native      # cargo test, the engine and the gates
npm run typecheck
npm run brand            # regenerate logo, icons and banner
```

Anything visual — interface, asset, terminal output, marketing — follows [the Sens visual identity](docs/brand/identity.md). Colours live in `src/brand/tokens.ts` and the mark's geometry in `src/brand/mark.ts`: import the token instead of retyping a hex, and edit the generator rather than the generated asset.

This repository does not take comments. Code explains itself with names and structure, or it gets extracted until it does. G5 enforces it on the model; the same applies to you.

## License

[MIT](LICENSE) — do what you want, just keep the copyright notice.
