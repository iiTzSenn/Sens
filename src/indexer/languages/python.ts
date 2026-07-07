import { statSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { rel } from "../../paths.js";
import type {
  SymbolInfo,
  Reference,
  FileInfo,
  ImportEdge,
  SymbolKind,
} from "../../types.js";
import type { LanguageParser, IndexContribution } from "./parser.js";

// web-tree-sitter is a CommonJS module with a default export (the Parser class,
// carrying `init` and `Language` as statics). It is loaded lazily so a
// TypeScript-only project never pays for the WASM runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSParser = any;

let parserPromise: Promise<TSParser> | null = null;

/** Locate the Python grammar WASM, whether running from `dist/` or from src. */
function grammarPath(): string {
  // Published package: copied next to the build output at `dist/grammars/`.
  const bundled = fileURLToPath(
    new URL("./grammars/tree-sitter-python.wasm", import.meta.url),
  );
  if (existsSync(bundled)) return bundled;
  // Dev / tests: pull straight from the tree-sitter-wasms dev dependency.
  try {
    const req = createRequire(import.meta.url);
    return req.resolve("tree-sitter-wasms/out/tree-sitter-python.wasm");
  } catch {
    throw new Error(
      "Sens: could not locate tree-sitter-python.wasm (Python grammar). " +
        "Reinstall sens-mcp, or add tree-sitter-wasms as a dependency in dev.",
    );
  }
}

async function getParser(): Promise<TSParser> {
  if (!parserPromise) {
    parserPromise = (async () => {
      const mod = await import("web-tree-sitter");
      const Parser = (mod as { default: TSParser }).default ?? mod;
      await Parser.init();
      const Python = await Parser.Language.load(grammarPath());
      const parser = new Parser();
      parser.setLanguage(Python);
      return parser;
    })();
  }
  return parserPromise;
}

function symbolId(file: string, name: string, line: number): string {
  return `${file}#${name}#${line}`;
}

/** Public by Python convention: not a `_leading_underscore` name. */
function isPublic(name: string): boolean {
  return !name.startsWith("_");
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** `def name(params) -> ret`, prefixed with `async ` when applicable. */
function funcSig(node: TSNode, name: string): string {
  const params = node.childForFieldName("parameters");
  const ret = node.childForFieldName("return_type");
  const prefix = node.text.startsWith("async") ? "async " : "";
  const p = params ? collapse(params.text) : "()";
  const r = ret ? ` -> ${collapse(ret.text)}` : "";
  return `${prefix}def ${name}${p}${r}`;
}

/** `class Name(Bases)`. */
function classSig(node: TSNode, name: string): string {
  const bases = node.childForFieldName("superclasses");
  return `class ${name}${bases ? collapse(bases.text) : ""}`;
}

/** Dotted segments of a `dotted_name` / `identifier` node. */
function dottedSegments(node: TSNode): string[] {
  if (node.type === "identifier") return [node.text];
  return node.namedChildren
    .filter((c: TSNode) => c.type === "identifier")
    .map((c: TSNode) => c.text);
}

/**
 * Resolve an imported module to a project file (best effort). Absolute imports
 * match by path suffix (projects have varied source roots); relative imports
 * (`from . import x`) resolve against the importing file's package directory.
 * Returns a project-relative POSIX path, or null if it points outside the repo.
 */
function resolveModule(
  fromRel: string,
  segs: string[],
  level: number,
  relSet: Set<string>,
): string | null {
  if (segs.length === 0 && level === 0) return null;
  const candidates = (base: string[]): string[] => {
    const joined = [...base, ...segs].join("/");
    return [`${joined}.py`, `${joined}/__init__.py`];
  };
  if (level > 0) {
    let baseParts = fromRel.split("/").slice(0, -1);
    for (let i = 1; i < level; i++) baseParts = baseParts.slice(0, -1);
    for (const cand of candidates(baseParts)) if (relSet.has(cand)) return cand;
    return null;
  }
  const cands = candidates([]);
  for (const cand of cands) if (relSet.has(cand)) return cand;
  for (const r of relSet) {
    for (const cand of cands) {
      if (r === cand || r.endsWith(`/${cand}`)) return r;
    }
  }
  return null;
}

/** Collect every identifier node in a subtree (used for the reference pass). */
function collectIdentifiers(node: TSNode, out: TSNode[]): void {
  if (node.type === "identifier") out.push(node);
  for (const child of node.namedChildren) collectIdentifiers(child, out);
}

async function build(root: string, absFiles: string[]): Promise<IndexContribution> {
  const parser = await getParser();

  const symbols: SymbolInfo[] = [];
  const files: FileInfo[] = [];
  const imports: ImportEdge[] = [];
  const references: Record<string, Reference[]> = {};

  // simple name -> symbol ids sharing it (references are resolved by name, the
  // most Sens can do for a dynamic language without full type inference).
  const byName = new Map<string, string[]>();
  // per file, byte offsets of declaration name nodes, to skip self-references.
  const declNameOffsets = new Map<string, Set<number>>();
  // per file, parsed identifier nodes, kept for the second (reference) pass.
  const fileTrees: { file: string; root: TSNode }[] = [];

  const relSet = new Set(absFiles.map((f) => rel(root, f)));

  const register = (
    info: SymbolInfo,
    simpleName: string,
    nameNode: TSNode | undefined,
    offsets: Set<number>,
  ): void => {
    symbols.push(info);
    references[info.id] = [];
    const list = byName.get(simpleName);
    if (list) list.push(info.id);
    else byName.set(simpleName, [info.id]);
    if (nameNode) offsets.add(nameNode.startIndex);
  };

  for (const abs of absFiles) {
    const file = rel(root, abs);
    let src: string;
    try {
      src = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const tree = parser.parse(src);
    const rootNode = tree.rootNode;
    const offsets = new Set<number>();
    declNameOffsets.set(file, offsets);
    const exportsList: string[] = [];

    // Unwrap `@decorator`-wrapped definitions to the def/class they wrap.
    const defBody = (n: TSNode): TSNode =>
      n.type === "decorated_definition"
        ? n.childForFieldName("definition") ?? n
        : n;

    for (const raw of rootNode.namedChildren) {
      const node = defBody(raw);

      if (node.type === "function_definition") {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) continue;
        const name = nameNode.text;
        const line = nameNode.startPosition.row + 1;
        const exported = isPublic(name);
        if (exported) exportsList.push(name);
        register(
          { id: symbolId(file, name, line), name, kind: "function", file, line, signature: funcSig(node, name), exported },
          name,
          nameNode,
          offsets,
        );
      } else if (node.type === "class_definition") {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) continue;
        const cname = nameNode.text;
        const line = nameNode.startPosition.row + 1;
        const exported = isPublic(cname);
        if (exported) exportsList.push(cname);
        register(
          { id: symbolId(file, cname, line), name: cname, kind: "class", file, line, signature: classSig(node, cname), exported },
          cname,
          nameNode,
          offsets,
        );
        const body = node.childForFieldName("body");
        for (const mraw of body ? body.namedChildren : []) {
          const m = defBody(mraw);
          if (m.type !== "function_definition") continue;
          const mNameNode = m.childForFieldName("name");
          if (!mNameNode) continue;
          const mname = mNameNode.text;
          const full = `${cname}.${mname}`;
          const mline = mNameNode.startPosition.row + 1;
          register(
            { id: symbolId(file, full, mline), name: full, kind: "method", file, line: mline, signature: funcSig(m, mname), exported: false },
            mname,
            mNameNode,
            offsets,
          );
        }
      } else if (node.type === "expression_statement") {
        // Module-level `NAME = ...` (or `NAME: T = ...`) is a variable symbol.
        const assign = node.namedChildren.find((c: TSNode) => c.type === "assignment");
        const left = assign?.childForFieldName("left");
        if (!left || left.type !== "identifier") continue;
        const name = left.text;
        const line = left.startPosition.row + 1;
        const kind: SymbolKind = /^[A-Z0-9_]+$/.test(name) ? "const" : "var";
        const exported = isPublic(name);
        if (exported) exportsList.push(name);
        register(
          { id: symbolId(file, name, line), name, kind, file, line, signature: name, exported },
          name,
          left,
          offsets,
        );
      } else if (node.type === "import_statement" || node.type === "import_from_statement") {
        collectImport(node, file, relSet, imports);
      }
    }

    files.push({ path: file, mtimeMs: statSync(abs).mtimeMs, exports: exportsList });
    fileTrees.push({ file, root: rootNode });
  }

  // Reference pass: any identifier whose text matches a known symbol name is a
  // usage of every symbol with that name (name-based, cross-file).
  for (const { file, root: rootNode } of fileTrees) {
    const skip = declNameOffsets.get(file) ?? new Set<number>();
    const ids: TSNode[] = [];
    collectIdentifiers(rootNode, ids);
    for (const id of ids) {
      if (skip.has(id.startIndex)) continue;
      const targets = byName.get(id.text);
      if (!targets) continue;
      const ref: Reference = { file, line: id.startPosition.row + 1 };
      for (const symId of targets) references[symId].push(ref);
    }
  }

  return { symbols, files, imports, references };
}

/** Extract one import statement into `imports`. */
function collectImport(
  node: TSNode,
  file: string,
  relSet: Set<string>,
  imports: ImportEdge[],
): void {
  if (node.type === "import_statement") {
    for (const child of node.namedChildren) {
      const target = child.type === "aliased_import"
        ? child.childForFieldName("name")
        : child;
      if (!target || (target.type !== "dotted_name" && target.type !== "identifier")) continue;
      const segs = dottedSegments(target);
      const to = resolveModule(file, segs, 0, relSet) ?? segs.join(".");
      imports.push({ from: file, to, names: [segs[segs.length - 1]] });
    }
    return;
  }
  // import_from_statement: `from <module> import a, b` or `from . import x`.
  const moduleNode = node.childForFieldName("module_name");
  let segs: string[] = [];
  let level = 0;
  if (moduleNode) {
    if (moduleNode.type === "relative_import") {
      const prefix = moduleNode.namedChildren.find((c: TSNode) => c.type === "import_prefix");
      level = prefix ? prefix.text.length : 1;
      const dotted = moduleNode.namedChildren.find((c: TSNode) => c.type === "dotted_name");
      if (dotted) segs = dottedSegments(dotted);
    } else {
      segs = dottedSegments(moduleNode);
    }
  }
  const names: string[] = [];
  for (const child of node.namedChildren) {
    if (child === moduleNode) continue;
    if (child.type === "wildcard_import") names.push("*");
    else if (child.type === "aliased_import") {
      const n = child.childForFieldName("name");
      if (n) names.push(dottedSegments(n)[0]);
    } else if (child.type === "dotted_name" || child.type === "identifier") {
      names.push(dottedSegments(child)[0]);
    }
  }
  const to = resolveModule(file, segs, level, relSet) ?? (segs.length ? segs.join(".") : ".");
  imports.push({ from: file, to, names });
}

export const pythonParser: LanguageParser = {
  name: "python",
  extensions: ["py", "pyi"],
  build,
};
