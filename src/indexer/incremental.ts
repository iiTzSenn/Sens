import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { comparePaths } from "../order.js";
import { INDEX_SCHEMA_VERSION } from "../types.js";
import type {
  FileInfo,
  ProjectIndex,
  Reference,
  SymbolInfo,
} from "../types.js";
import { parserForFile, type IndexContribution } from "./languages/parser.js";
import { resolveImport, typescriptParser } from "./languages/typescript.js";

const MAX_TOUCHED = 25;

const SPECIFIER =
  /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;

export async function updateIndex(
  root: string,
  previous: ProjectIndex,
  touched: string[],
): Promise<ProjectIndex | null> {
  if (previous.schemaVersion !== INDEX_SCHEMA_VERSION) return null;

  const paths = [...new Set(touched.map((file) => relativeTo(root, file)))];
  if (paths.length === 0 || paths.length > MAX_TOUCHED) return null;
  if (paths.some((file) => parserForFile(file) !== typescriptParser)) return null;

  const alive = paths.filter((file) => existsSync(path.join(root, file)));
  const closure = new Set(closureOf(root, previous, alive));
  const part = alive.length
    ? await typescriptParser.build(
        root,
        [...closure].map((file) => path.join(root, file)),
        {
          referencesFrom: new Set(alive),
          exportsElsewhere: exportsOutside(previous, closure),
        },
      )
    : { symbols: [], files: [], imports: [], references: {} };

  const edited = new Set(paths);
  if (namedElsewhere(root, previous, edited, exportsSwappedBy(previous, part, edited))) {
    return null;
  }
  return merge(previous, edited, new Set(alive), part);
}

function exportsOutside(
  previous: ProjectIndex,
  closure: Set<string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const symbol of previous.symbols) {
    if (!symbol.exported || closure.has(symbol.file)) continue;
    const list = out.get(symbol.name);
    if (list) list.push(symbol.id);
    else out.set(symbol.name, [symbol.id]);
  }
  return out;
}

function exportsSwappedBy(
  previous: ProjectIndex,
  part: IndexContribution,
  touched: Set<string>,
): string[] {
  const before = exportedNames(previous.symbols, touched);
  const after = exportedNames(part.symbols, touched);
  return [
    ...[...before].filter((name) => !after.has(name)),
    ...[...after].filter((name) => !before.has(name)),
  ];
}

function exportedNames(symbols: SymbolInfo[], files: Set<string>): Set<string> {
  return new Set(
    symbols.filter((s) => s.exported && files.has(s.file)).map((s) => s.name),
  );
}

function namedElsewhere(
  root: string,
  previous: ProjectIndex,
  touched: Set<string>,
  names: string[],
): boolean {
  if (names.length === 0) return false;
  const quoted = names.map((name) => [`"${name}"`, `'${name}'`, "`" + name + "`"]);
  for (const file of previous.files) {
    if (touched.has(file.path)) continue;
    let source: string;
    try {
      source = readFileSync(path.join(root, file.path), "utf8");
    } catch {
      continue;
    }
    if (quoted.some((forms) => forms.some((form) => source.includes(form)))) return true;
  }
  return false;
}

function relativeTo(root: string, file: string): string {
  const clean = file.split(path.sep).join("/");
  if (!path.isAbsolute(file)) return clean.replace(/^\.\//, "");
  return path.relative(root, file).split(path.sep).join("/");
}

function closureOf(
  root: string,
  previous: ProjectIndex,
  seeds: string[],
): string[] {
  const known = new Set(previous.files.map((file) => file.path));
  const edges = new Map<string, string[]>();
  for (const edge of previous.imports) {
    const list = edges.get(edge.from);
    if (list) list.push(edge.to);
    else edges.set(edge.from, [edge.to]);
  }

  const seeded = new Set(seeds);
  const reached = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (reached.has(file)) continue;
    reached.add(file);
    const next = seeded.has(file)
      ? importsWrittenIn(root, file, known)
      : (edges.get(file) ?? []);
    for (const target of next) {
      if (known.has(target) && !reached.has(target)) queue.push(target);
    }
  }
  return [...reached].filter((file) => known.has(file) || seeded.has(file));
}

function importsWrittenIn(
  root: string,
  file: string,
  known: Set<string>,
): string[] {
  let source: string;
  try {
    source = readFileSync(path.join(root, file), "utf8");
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const match of source.matchAll(SPECIFIER)) {
    const target = resolveImport(known, file, match[1] as string);
    if (target) found.push(target);
  }
  return found;
}

function merge(
  previous: ProjectIndex,
  touched: Set<string>,
  alive: Set<string>,
  part: IndexContribution,
): ProjectIndex {
  const renamed = idsThatMoved(previous.symbols, part.symbols, alive);
  return {
    ...previous,
    createdAt: Date.now(),
    files: mergeFiles(previous.files, part.files, touched, alive),
    symbols: mergeSymbols(previous.symbols, part.symbols, touched, alive),
    imports: [
      ...previous.imports.filter((edge) => !touched.has(edge.from)),
      ...part.imports.filter((edge) => alive.has(edge.from)),
    ],
    references: mergeReferences(previous, part, touched, alive, renamed),
  };
}

function mergeFiles(
  previous: FileInfo[],
  fresh: FileInfo[],
  touched: Set<string>,
  alive: Set<string>,
): FileInfo[] {
  return [
    ...previous.filter((file) => !touched.has(file.path)),
    ...fresh.filter((file) => alive.has(file.path)),
  ].sort((a, b) => comparePaths(a.path, b.path));
}

function mergeSymbols(
  previous: SymbolInfo[],
  fresh: SymbolInfo[],
  touched: Set<string>,
  alive: Set<string>,
): SymbolInfo[] {
  const byFile = new Map<string, SymbolInfo[]>();
  for (const symbol of fresh) {
    if (!alive.has(symbol.file)) continue;
    const list = byFile.get(symbol.file);
    if (list) list.push(symbol);
    else byFile.set(symbol.file, [symbol]);
  }

  const written = new Set<string>();
  const out: SymbolInfo[] = [];
  for (const symbol of previous) {
    if (!touched.has(symbol.file)) {
      out.push(symbol);
      continue;
    }
    if (written.has(symbol.file)) continue;
    written.add(symbol.file);
    out.push(...(byFile.get(symbol.file) ?? []));
  }
  for (const [file, symbols] of byFile) {
    if (!written.has(file)) out.push(...symbols);
  }
  return out;
}

function idsThatMoved(
  previous: SymbolInfo[],
  fresh: SymbolInfo[],
  alive: Set<string>,
): Map<string, string> {
  const before = groupByName(previous.filter((s) => alive.has(s.file)));
  const after = groupByName(fresh.filter((s) => alive.has(s.file)));
  const moved = new Map<string, string>();
  for (const [key, olds] of before) {
    const news = after.get(key) ?? [];
    olds.forEach((old, slot) => {
      const now = news[slot];
      if (now) moved.set(old.id, now.id);
    });
  }
  return moved;
}

function groupByName(symbols: SymbolInfo[]): Map<string, SymbolInfo[]> {
  const out = new Map<string, SymbolInfo[]>();
  for (const symbol of symbols) {
    const key = `${symbol.file}::${symbol.name}`;
    const list = out.get(key);
    if (list) list.push(symbol);
    else out.set(key, [symbol]);
  }
  return out;
}

function mergeReferences(
  previous: ProjectIndex,
  part: IndexContribution,
  touched: Set<string>,
  alive: Set<string>,
  renamed: Map<string, string>,
): Record<string, Reference[]> {
  const gone = new Set(
    previous.symbols.filter((s) => touched.has(s.file)).map((s) => s.id),
  );
  const out: Record<string, Reference[]> = {};

  for (const [id, refs] of Object.entries(previous.references)) {
    const now = renamed.get(id);
    if (!now && gone.has(id)) continue;
    out[now ?? id] = refs.filter((ref) => !touched.has(ref.file));
  }
  for (const [id, refs] of Object.entries(part.references)) {
    const mine = refs.filter((ref) => alive.has(ref.file));
    out[id] = [...(out[id] ?? []), ...mine];
  }

  for (const refs of Object.values(out)) {
    refs.sort((a, b) => comparePaths(a.file, b.file) || a.line - b.line);
  }
  return out;
}
