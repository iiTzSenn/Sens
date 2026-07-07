# Sens

> A project index for [Claude Code](https://www.anthropic.com/claude-code) — let the model **query** your codebase instead of reading it all.

**Status: early development (v1 in progress).**

## Why

If you use Claude Code on a **subscription**, your pain isn't a per-token bill — it's the **usage limit** and the **context window filling up**. Every time the agent opens 20 files just to orient itself, it burns your quota and bloats the context (which then compacts and loses memory).

Sens keeps a compact **index** of your project and serves it to Claude over **MCP**, so the model asks focused questions — *"where is `login`?"*, *"who uses it?"*, *"does something like this already exist?"* — and only reads what it truly needs.

Two payoffs from one engine:

- **Fewer tokens / cleaner context** → your subscription lasts longer, long sessions stay sharp.
- **Cleaner code** → reuse what already exists instead of duplicating, and surface **dead code**.

> Sens is not a "write-less" rules engine (that's what [ponytail](https://github.com/DietrichGebert/ponytail) does well). Sens is the missing piece underneath: the **project knowledge** that makes "reuse what exists" actually work. They're complementary.

## Status / roadmap

See the design and plan in [`docs/`](docs/):

- [Design spec](docs/specs/2026-07-07-sens-design.md)
- [Implementation plan](docs/plans/2026-07-07-sens-v1-implementation-plan.md)

## License

MIT
