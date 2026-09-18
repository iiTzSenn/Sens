# `sens-hook` — the PreToolUse hook as a native binary

Claude Code runs the hook **once per Read/Grep/Glob the model makes**. Measured
on a 1,165-file project, that is where Sens's per-call latency lives, and most
of it is not work — it is Node starting up.

This crate is the read path only. Indexing stays in TypeScript.

## Why

| | latency |
| --- | --- |
| `node dist/hook.js`, no daemon | ~660 ms |
| `node dist/hook.js`, daemon warm | ~200 ms |
| **`sens-hook` (this crate)** | **~70 ms** |
| `node -e "0"` — Node doing *nothing* | ~214 ms |

The last row is the point: the native binary finishes in a third of the time
Node needs just to start. That floor is why the daemon exists in the Node
implementation, and why it stops mattering here.

Its own breakdown on that project (`SENS_TIMING=1`, 10.9 MB index):

```
leer índice          6 ms
parsear índice      22 ms   <- references captured raw, parsed on demand
comprobar frescura  19 ms   <- ~1,300 stat calls, across the rayon pool
construir motor      6 ms
consulta             0 ms
```

## The safety rule

It answers **only when it is certain**, and hands everything else to Node:

- index missing, or written by a different schema version → Node
- no freshness metadata → Node
- anything moved on disk at all → Node (only the TypeScript side can tell an
  indexable new file from an ignored one — it has the globs and `.gitignore`)
- `SessionStart`, or a reminder that fires once per session → Node (they need
  config and marker files this binary does not read)

Being wrong about "fresh" would mean answering the model from a stale index.
Being wrong the other way just costs the Node round trip that is paid today.

Delegation runs `node $SENS_NODE_HOOK` and passes the payload through. With the
variable unset it stays silent, which is what the hook does on any failure: the
tool call proceeds untouched.

## Verifying

The model must not be able to tell which implementation answered, so the
acceptance criterion is byte-identical output:

```bash
cd rust/sens-hook && cargo build --release && cd ../..
node dist/cli.js index      # the hook reads .sens/, so it must exist
node rust/diff-hook.mjs     # both implementations, same payloads, diffed
cd rust/sens-hook && cargo test
```

`diff-hook.mjs` covers every branch: a symbol Grep, a regex Grep, an unknown
name, Reads of indexed and non-indexed files, Glob, an unrelated tool, and an
empty payload. All 22 currently match exactly.

## Not done yet

Distribution. The binary is built from source here; shipping it means per-platform
npm packages under `optionalDependencies`, the way esbuild, swc and Biome do it,
so `npx sens-mcp` keeps working untouched.

## Distribution

The binary ships the way esbuild, swc and Biome ship theirs: one npm package per
platform, pulled in as an `optionalDependency` so npm installs only the one that
matches. `npx sens-mcp` keeps working untouched, and a platform with no prebuilt
binary simply gets the TypeScript hook.

```
@sens-mcp/win32-x64     @sens-mcp/darwin-x64     @sens-mcp/linux-x64
@sens-mcp/win32-arm64   @sens-mcp/darwin-arm64   @sens-mcp/linux-arm64
```

`src/native.ts` resolves the binary at runtime: the platform package first, then
a local `cargo build --release` so a checkout works without publishing anything.
`sens init` writes whichever it found into `.claude/settings.json`, falling back
to the `sens-hook` node executable when there is none.

Finding the TypeScript half works the other way round and needs no configuration:
the binary walks up from its own location looking for `dist/hook.js` or
`node_modules/sens-mcp/dist/hook.js`, which covers both a published install and a
git checkout. `SENS_NODE_HOOK` overrides it.

`optionalDependencies` are **not** committed to `package.json`: the platform
packages do not exist on the registry until a release publishes them, and listing
them early breaks `npm ci` for everyone. `.github/workflows/release.yml` builds
the matrix, then writes the manifest immediately before publishing —
platform packages first, `sens-mcp` last.

```bash
npm run build:native
npm run package:native            # npm/<host-platform>/
npm run package:native -- linux-x64 path/to/binary
node scripts/package-native.mjs --manifest-only
```
