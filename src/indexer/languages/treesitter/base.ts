import { statSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { rel } from "../../../paths.js";
import type {
  SymbolInfo,
  Reference,
  FileInfo,
  ImportEdge,
  SymbolKind,
} from "../../../types.js";
import type { IndexContribution } from "../parser.js";

// web-tree-sitter is loaded lazily (and only its default export used) so a
// project without any tree-sitter language never pays for the WASM runtime.
// The whole framework is intentionally untyped against the grammar: tree-sitter
// nodes are dynamic, so `Node` is `any` and helpers narrow by node.type.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Node = any;
type TSParser = any;

interface Loaded {
  parser: TSParser;
  language: TSParser;
}
const parsers = new Map<string, Promise<Loaded>>();
let runtime: Promise<TSParser> | null = null;

/** The web-tree-sitter runtime (the Parser class), initialised exactly once.
 * Calling `Parser.init()` more than once corrupts the emscripten runtime. */
function getRuntime(): Promise<TSParser> {
  if (!runtime) {
    runtime = (async () => {
      const mod = await import("web-tree-sitter");
      const Parser = (mod as { default: TSParser }).default ?? mod;
      await Parser.init();
      return Parser;
    })();
  }
  return runtime;
}

/** Locate a grammar WASM, whether running from `dist/` or from source. */
function grammarPath(grammar: string): string {
  const file = `tree-sitter-${grammar}.wasm`;
  // Published package: copied next to the build output at `dist/grammars/`.
  const bundled = fileURLToPath(new URL(`./grammars/${file}`, import.meta.url));
  if (existsSync(bundled)) return bundled;
  // Dev / tests: pull straight from the tree-sitter-wasms dev dependency.
  try {
    return createRequire(import.meta.url).resolve(`tree-sitter-wasms/out/${file}`);
  } catch {
    throw new Error(
      `Sens: could not locate ${file}. Reinstall sens-mcp, ` +
        "or add tree-sitter-wasms as a dependency in dev.",
    );
  }
}

/** A tree-sitter parser for `grammar`, initialised once and cached. */
export async function getParser(grammar: string): Promise<TSParser> {
  return (await getLoaded(grammar)).parser;
}

function getLoaded(grammar: string): Promise<Loaded> {
  let p = parsers.get(grammar);
  if (!p) {
    p = (async () => {
      const Parser = await getRuntime();
      const language = await Parser.Language.load(grammarPath(grammar));
      const parser = new Parser();
      parser.setLanguage(language);
      return { parser, language };
    })();
    parsers.set(grammar, p);
  }
  return p;
}

/**
 * Free every loaded tree-sitter grammar. Loading many grammar WASM modules and
 * then letting Node tear the process down can crash in emscripten's isolate
 * disposal; releasing them once indexing is done avoids that, and the MCP
 * server simply reloads on the next (rare) rebuild. No-op if none are loaded.
 */
export async function disposeParsers(): Promise<void> {
  const loaded = [...parsers.values()];
  parsers.clear();
  for (const p of loaded) {
    try {
      const { parser, language } = await p;
      parser.delete?.();
      language.delete?.();
    } catch {
      /* best effort */
    }
  }
}

// ---- node helpers shared by every language extractor ------------------------

export const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Child by field name, or undefined. */
export const field = (node: Node, name: string): Node | undefined =>
  node?.childForFieldName(name) ?? undefined;

/** First direct named child of a given type, or undefined. */
export function named(node: Node, type: string): Node | undefined {
  for (const c of node.namedChildren) if (c.type === type) return c;
  return undefined;
}

/** All direct named children of a given type. */
export function allNamed(node: Node, type: string): Node[] {
  return node.namedChildren.filter((c: Node) => c.type === type);
}

/** True if `node` has a direct child (named or anonymous) of `type` — used to
 * read keyword tokens like `interface`, `struct`, `pub`. */
export function hasToken(node: Node, type: string): boolean {
  return node.children.some((c: Node) => c.type === type);
}

/** All named descendants of a given type (self excluded), depth-first. */
export function descendants(node: Node, type: string): Node[] {
  const out: Node[] = [];
  const walk = (n: Node): void => {
    if (n.type === type) out.push(n);
    for (const c of n.namedChildren) walk(c);
  };
  for (const c of node.namedChildren) walk(c);
  return out;
}

/** First named descendant of a given type, or undefined. */
export function firstDescendant(node: Node, type: string): Node | undefined {
  return descendants(node, type)[0];
}

/** A compact one-line signature: the declaration header up to its body. */
export function headerSig(node: Node): string {
  const t: string = node.text;
  let end = t.length;
  const brace = t.indexOf("{");
  const nl = t.indexOf("\n");
  if (brace !== -1) end = Math.min(end, brace);
  if (nl !== -1) end = Math.min(end, nl);
  return collapse(t.slice(0, end)).replace(/[;{=]\s*$/, "").trim();
}

/**
 * Resolve dotted path segments (e.g. `com.app.User`) to a project file by
 * suffix match, trying each extension and an `/__init__`-style index file when
 * given. Returns a project-relative POSIX path or null.
 */
export function resolveSuffix(
  relSet: Set<string>,
  segs: string[],
  exts: string[],
): string | null {
  if (segs.length === 0) return null;
  const joined = segs.join("/");
  for (const ext of exts) {
    const cand = joined + ext;
    if (relSet.has(cand)) return cand;
    for (const r of relSet) if (r === cand || r.endsWith(`/${cand}`)) return r;
  }
  return null;
}

// ---- the driver -------------------------------------------------------------

export interface EmitSymbol {
  name: string;
  kind: SymbolKind;
  /** The whole declaration node (used to derive a default signature). */
  node: Node;
  /** The name token; its position anchors the symbol and is skipped as a use. */
  nameNode: Node;
  exported: boolean;
  /** Override the derived one-line signature. */
  signature?: string;
  /** Name used for reference matching (defaults to the part after the last `.`). */
  simpleName?: string;
}

export interface Emit {
  symbol(s: EmitSymbol): void;
  import(edge: ImportEdge): void;
}

export interface Ctx {
  file: string;
  relSet: Set<string>;
}

/** Per-language extractor: walk `root` and emit this file's symbols/imports. */
export type Extract = (root: Node, emit: Emit, ctx: Ctx) => void;

/** The inside of a quoted string leaf (`"foo"`/`'foo'`/`` `foo` ``), if it is one
 * and is long enough to be a distinctive name; otherwise null. */
function dequote(s: string): string | null {
  if (s.length < 5) return null; // e.g. "abc" -> 3 chars of content
  const q = s[0];
  if ((q === '"' || q === "'" || q === "`") && s[s.length - 1] === q) {
    return s.slice(1, -1);
  }
  return null;
}

/** Named leaf nodes (no named children) — the identifier-like tokens whose text
 * we match against symbol names in the reference pass. Language-agnostic. */
function collectLeaves(node: Node, out: Node[]): void {
  if (node.namedChildCount === 0) {
    if (node.isNamed) out.push(node);
    return;
  }
  for (const c of node.namedChildren) collectLeaves(c, out);
}

/**
 * Build an index contribution for one tree-sitter language: parse each file,
 * let `extract` emit symbols/imports, then resolve references by name (the best
 * a syntax-only parser can do for languages without whole-program type info).
 */
export async function buildTreeSitter(
  root: string,
  absFiles: string[],
  grammar: string,
  extract: Extract,
): Promise<IndexContribution> {
  const parser = await getParser(grammar);

  const symbols: SymbolInfo[] = [];
  const files: FileInfo[] = [];
  const imports: ImportEdge[] = [];
  const references: Record<string, Reference[]> = {};
  const byName = new Map<string, string[]>();
  const trees: { file: string; tree: Node; root: Node; skip: Set<number> }[] = [];
  const relSet = new Set(absFiles.map((f) => rel(root, f)));

  for (const abs of absFiles) {
    const file = rel(root, abs);
    let src: string;
    try {
      src = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const tree = parser.parse(src);
    if (!tree) continue;
    const rootNode = tree.rootNode;
    const skip = new Set<number>();
    const exportsList: string[] = [];

    const emit: Emit = {
      symbol(s) {
        const line = s.nameNode.startPosition.row + 1;
        const id = `${file}#${s.name}#${line}`;
        const simple =
          s.simpleName ??
          (s.name.includes(".") ? s.name.slice(s.name.lastIndexOf(".") + 1) : s.name);
        symbols.push({
          id,
          name: s.name,
          kind: s.kind,
          file,
          line,
          signature: s.signature ?? headerSig(s.node),
          exported: s.exported,
        });
        references[id] = [];
        const list = byName.get(simple);
        if (list) list.push(id);
        else byName.set(simple, [id]);
        skip.add(s.nameNode.startIndex);
        if (s.exported && s.kind !== "method") exportsList.push(s.name);
      },
      import(edge) {
        imports.push(edge);
      },
    };

    extract(rootNode, emit, { file, relSet });
    files.push({ path: file, mtimeMs: statSync(abs).mtimeMs, exports: exportsList });
    trees.push({ file, tree, root: rootNode, skip });
  }

  // Reference pass: a leaf token matching a known symbol name is a use of every
  // symbol with that name (name-based, cross-file). Over-counts rather than
  // misses, which keeps dead-code candidates conservative.
  for (const { file, tree, root: rootNode, skip } of trees) {
    const leaves: Node[] = [];
    collectLeaves(rootNode, leaves);
    for (const leaf of leaves) {
      if (skip.has(leaf.startIndex)) continue;
      // Match the identifier itself, and — for reflective access like
      // `getattr(x, "foo")` or a name-keyed registry — the contents of a quoted
      // string literal (some grammars keep the quotes on the leaf).
      let targets = byName.get(leaf.text);
      if (!targets) {
        const inner = dequote(leaf.text);
        if (inner) targets = byName.get(inner);
      }
      if (!targets) continue;
      const ref: Reference = { file, line: leaf.startPosition.row + 1 };
      for (const symId of targets) references[symId].push(ref);
    }
    tree.delete?.(); // free the emscripten-side parse tree
  }

  return { symbols, files, imports, references };
}
