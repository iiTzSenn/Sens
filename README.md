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
  <b>A desktop coding agent over Claude Code, on your own subscription.</b><br>
  It chats with your project, shows every step the agent takes, and lets you pick the plugins, skills and MCP servers each project may use.
</p>

<p align="center">
  <img src="docs/app-code.png" alt="The Sens desktop app: project tree and code pane" width="900">
</p>

> [!NOTE]
> Sens is in early development. There is no release to download yet — you build it yourself (see [Install](#install)). The packaged installer is Windows-only today; other platforms are untested. The interface speaks English, Spanish, French, German, Japanese and Simplified Chinese.

---

## What it is

A window around the unmodified `claude` CLI. Sens never touches your Claude credentials: you sign in to Claude Code yourself, and Sens drives it over its own stream protocol — one process per session, resumed when you come back to it.

## How a session goes

1. **You open a folder.** Sessions live next to it, in `.sens/sessions`, and the sidebar groups them by project.
2. **You pick the model, effort, thinking and permissions.** The model list is the one Claude Code itself offers, read from it for free every day.
3. **You ask.** Text, pictures in any format the window can draw (converted and resized to what Claude takes), files, folders, and long pastes that become an attachment of their own; `@` mentions a file, `/` offers Claude Code's commands and your skills, and `↑`/`↓` bring back what you sent before. The reply streams in, and every tool call gets its own card: commands coloured in their own shell, output in its program's own colours, search results, diffs, checklists, web sources, background tasks you can stop. Each thought says what it is about, and a long stretch of work folds into one line once the reply is done.
4. **You answer when it asks.** Permission requests, questions and plans arrive as prompts in the thread.
5. **The session names itself** after the first reply. Rename it from its `⋯` menu whenever you like.

Beside the chat, the tool panel shows the project's files, what changed since the last commit, a browser for its pages, a terminal in its folder (`Ctrl+Ñ`, which Claude can read when you ask about it) and the work running in the background. A ring under the message says how full the context is, what the session has used and how much of your plan's five-hour and weekly limits is gone, and compacts the conversation on request; and Sens tells you when a session ends or needs you while you are elsewhere. A new session can also work in a git worktree of its own, on a new branch, so your folder stays as it is until you merge.

## Capabilities

**Capabilities → Explore** is a market of what Claude Code can load, browsed by purpose — code, design, data, cloud, security, productivity and more — or searched as you type:

| Source | What |
| --- | --- |
| Anthropic | the official plugin directory, the knowledge-work, financial-services and life-sciences plugins, Anthropic's skills and its MCP connectors |
| Community | the third-party plugins Anthropic reviewed and pinned to a commit |
| skills.sh | the open skills index, searched as you type |

Every entry has a page with its readme, every file it ships and **what it runs** — hooks, MCP servers, executables and the variables it will ask for — before you install it. Installing downloads it once, pinned to a commit; enabling it is per project. Plugins reach the agent with `--plugin-dir`, never through your own Claude Code configuration.

<p align="center">
  <img src="docs/app-models.png" alt="Picking the model" width="900">
</p>

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

The installer is Sens's own: a small window drawn in HTML that carries the app inside it, installs per user without UAC, and takes over an install made by the old NSIS setup in place. Before it installs, it asks which language Sens should speak and how it should look — dark, light or as Windows, and one of five accents — and the whole window, the stone included, changes as you choose. **Settings › Language** and **Settings › Appearance** change them later. The first time Sens opens, a welcome sets your name, checks Claude Code, and brings your Claude Code sessions and the MCP servers of other apps.

It will refuse to build an unsigned one by accident. Give it a certificate from the Windows store with `SENS_SIGN_THUMBPRINT`, your own signing tool with `SENS_SIGN_COMMAND` (which must contain `%1`), or pass `--unsigned` when you know that is what you want. macOS needs notarization, which is a different certificate and a different story — not done yet.

## Develop

```bash
npm install
npm test                 # vitest: the interface and the brand
cargo test --manifest-path rust/sens-agent/Cargo.toml   # the chat engine
cargo test --manifest-path rust/sens-app/Cargo.toml     # the app: capabilities, market, sessions
npm run typecheck
npm run brand            # regenerate logo, icons and banner
npm run dev:setup -w sens-app-ui   # the installer in a browser: ?mode=update, ?mode=uninstall, ?running=1, ?fail=extract, ?look=light.iris, ?language=fr
npm run setup:dev        # the installer in its real window, as a demo that writes nothing
```

The app's own dev server shows the welcome with `?welcome` in the URL, the news after an update with `?news`, any look with `?look=light.iris`, and any language with `?language=ja`.

Anything visual — interface, asset, terminal output, marketing — follows [the Sens visual identity](docs/brand/identity.md). Anything a person reads is written in all six languages, as [Sens in six languages](docs/i18n.md) describes. Colours live in `src/brand/tokens.ts` and the mark's geometry in `src/brand/mark.ts`: import the token instead of retyping a hex, and edit the generator rather than the generated asset.

This repository does not take comments. Code explains itself with names and structure, or it gets extracted until it does.

## License

[MIT](LICENSE) — do what you want, just keep the copyright notice.
