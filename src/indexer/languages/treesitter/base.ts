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

export type Node = any;
type TSParser = any;

interface Loaded {
  parser: TSParser;
  language: TSParser;
}
const parsers = new Map<string, Promise<Loaded>>();
let runtime: Promise<TSParser> | null = null;

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

function grammarPath(grammar: string): string {
  const file = `tree-sitter-${grammar}.wasm`;

  const bundled = fileURLToPath(new URL(`./grammars/${file}`, import.meta.url));
  if (existsSync(bundled)) return bundled;

  try {
    return createRequire(import.meta.url).resolve(`tree-sitter-wasms/out/${file}`);
  } catch {
    throw new Error(
      `Sens: could not locate ${file}. Reinstall sens-mcp, ` +
        "or add tree-sitter-wasms as a dependency in dev.",
    );
  }
}

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

export async function disposeParsers(): Promise<void> {
  const loaded = [...parsers.values()];
  parsers.clear();
  for (const p of loaded) {
    try {
      const { parser, language } = await p;
      parser.delete?.();
      language.delete?.();
    } catch {

    }
  }
}

export const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

export const field = (node: Node, name: string): Node | undefined =>
  node?.childForFieldName(name) ?? undefined;

export function named(node: Node, type: string): Node | undefined {
  for (const c of node.namedChildren) if (c.type === type) return c;
  return undefined;
}

export function allNamed(node: Node, type: string): Node[] {
  return node.namedChildren.filter((c: Node) => c.type === type);
}

export function hasToken(node: Node, type: string): boolean {
  return node.children.some((c: Node) => c.type === type);
}

export function descendants(node: Node, type: string): Node[] {
  const out: Node[] = [];
  const walk = (n: Node): void => {
    if (n.type === type) out.push(n);
    for (const c of n.namedChildren) walk(c);
  };
  for (const c of node.namedChildren) walk(c);
  return out;
}

export function firstDescendant(node: Node, type: string): Node | undefined {
  return descendants(node, type)[0];
}

export function headerSig(node: Node): string {
  const t: string = node.text;
  let end = t.length;
  const brace = t.indexOf("{");
  const nl = t.indexOf("\n");
  if (brace !== -1) end = Math.min(end, brace);
  if (nl !== -1) end = Math.min(end, nl);
  return collapse(t.slice(0, end)).replace(/[;{=]\s*$/, "").trim();
}

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

export interface EmitSymbol {
  name: string;
  kind: SymbolKind;

  node: Node;

  nameNode: Node;
  exported: boolean;

  signature?: string;

  simpleName?: string;

  entry?: boolean;
}

export interface Emit {
  symbol(s: EmitSymbol): void;
  import(edge: ImportEdge): void;
}

export interface Ctx {
  file: string;
  relSet: Set<string>;
}

export type Extract = (root: Node, emit: Emit, ctx: Ctx) => void;

function dequote(s: string): string | null {
  if (s.length < 5) return null;
  const q = s[0];
  if ((q === '"' || q === "'" || q === "`") && s[s.length - 1] === q) {
    return s.slice(1, -1);
  }
  return null;
}

interface SymbolRange {
  start: number;
  end: number;
  id: string;
}

function enclosingId(ranges: SymbolRange[], pos: number): string | undefined {
  let id: string | undefined;
  let bestStart = -1;
  for (const r of ranges) {
    if (r.start <= pos && pos < r.end && r.start > bestStart) {
      id = r.id;
      bestStart = r.start;
    }
  }
  return id;
}

function collectLeaves(node: Node, out: Node[]): void {
  if (node.namedChildCount === 0) {
    if (node.isNamed) out.push(node);
    return;
  }
  for (const c of node.namedChildren) collectLeaves(c, out);
}

export interface TreeSitterOptions {

  scope?: "name" | "import" | "package";

  isQualifiedUse?: (leaf: Node) => boolean;
}

const dirOf = (file: string): string => {
  const i = file.lastIndexOf("/");
  return i === -1 ? "" : file.slice(0, i);
};

export async function buildTreeSitter(
  root: string,
  absFiles: string[],
  grammar: string,
  extract: Extract,
  opts: TreeSitterOptions = {},
): Promise<IndexContribution> {
  const parser = await getParser(grammar);
  const symbols: SymbolInfo[] = [];
  const files: FileInfo[] = [];
  const imports: ImportEdge[] = [];
  const references: Record<string, Reference[]> = {};
  const byName = new Map<string, string[]>();
  const fileById = new Map<string, string>();
  const rangesByFile = new Map<string, SymbolRange[]>();
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
    const ranges: SymbolRange[] = [];

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
          ...(s.entry ? { entry: true } : {}),
        });
        references[id] = [];
        fileById.set(id, file);
        const list = byName.get(simple);
        if (list) list.push(id);
        else byName.set(simple, [id]);
        ranges.push({ start: s.node.startIndex, end: s.node.endIndex, id });
        skip.add(s.nameNode.startIndex);
        if (s.exported && s.kind !== "method") exportsList.push(s.name);
      },
      import(edge) {
        imports.push(edge);
      },
    };

    extract(rootNode, emit, { file, relSet });
    rangesByFile.set(file, ranges);
    files.push({ path: file, mtimeMs: statSync(abs).mtimeMs, exports: exportsList });
    trees.push({ file, tree, root: rootNode, skip });
  }

  const narrowing = opts.scope === "import" || opts.scope === "package";
  const usePackage = opts.scope === "package";
  const importedFiles = new Map<string, Set<string>>();
  if (narrowing) {
    for (const edge of imports) {
      if (!relSet.has(edge.to)) continue;
      const set = importedFiles.get(edge.from);
      if (set) set.add(edge.to);
      else importedFiles.set(edge.from, new Set([edge.to]));
    }
  }

  for (const { file, tree, root: rootNode, skip } of trees) {
    const ranges = rangesByFile.get(file) ?? [];
    const imported = importedFiles.get(file);
    const fileDir = usePackage ? dirOf(file) : "";
    const leaves: Node[] = [];
    collectLeaves(rootNode, leaves);
    for (const leaf of leaves) {
      if (skip.has(leaf.startIndex)) continue;

      let targets = byName.get(leaf.text);
      if (!targets) {
        const inner = dequote(leaf.text);
        if (inner) targets = byName.get(inner);
      }
      if (!targets) continue;

      if (narrowing && !(usePackage && opts.isQualifiedUse?.(leaf))) {
        const visible = targets.filter((id) => {
          const f = fileById.get(id) as string;
          if (f === file || (imported && imported.has(f))) return true;
          return usePackage && dirOf(f) === fileDir;
        });
        if (visible.length) targets = visible;
      }
      const line = leaf.startPosition.row + 1;
      const from = enclosingId(ranges, leaf.startIndex);
      for (const symId of targets) {
        references[symId].push(
          from && from !== symId ? { file, line, from } : { file, line },
        );
      }
    }
    tree.delete?.();
  }
  return { symbols, files, imports, references };
}
