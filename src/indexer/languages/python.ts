import type { SymbolKind } from "../../types.js";
import type { LanguageParser } from "./parser.js";
import {
  buildTreeSitter,
  collapse,
  field,
  named,
  allNamed,
  type Node,
  type Emit,
  type Ctx,
} from "./treesitter/base.js";

/** Public by Python convention: not a `_leading_underscore` name. */
const isPublic = (name: string): boolean => !name.startsWith("_");

/** `def name(params) -> ret`, prefixed with `async ` when applicable. */
function funcSig(node: Node, name: string): string {
  const params = field(node, "parameters");
  const ret = field(node, "return_type");
  const prefix = node.text.startsWith("async") ? "async " : "";
  const p = params ? collapse(params.text) : "()";
  const r = ret ? ` -> ${collapse(ret.text)}` : "";
  return `${prefix}def ${name}${p}${r}`;
}

/** `class Name(Bases)`. */
function classSig(node: Node, name: string): string {
  const bases = field(node, "superclasses");
  return `class ${name}${bases ? collapse(bases.text) : ""}`;
}

/** Dotted segments of a `dotted_name` / `identifier` node. */
function dottedSegments(node: Node): string[] {
  if (node.type === "identifier") return [node.text];
  return allNamed(node, "identifier").map((c: Node) => c.text);
}

/**
 * Resolve an imported module to a project file (best effort). Absolute imports
 * match by path suffix; relative imports (`from . import x`) resolve against the
 * importing file's package directory. Returns a project-relative path or null.
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
    for (const cand of cands) if (r === cand || r.endsWith(`/${cand}`)) return r;
  }
  return null;
}

/** Unwrap `@decorator`-wrapped definitions to the def/class they wrap. */
const defBody = (n: Node): Node =>
  n.type === "decorated_definition" ? field(n, "definition") ?? n : n;

function collectImport(node: Node, emit: Emit, ctx: Ctx): void {
  if (node.type === "import_statement") {
    for (const child of node.namedChildren) {
      const target = child.type === "aliased_import" ? field(child, "name") : child;
      if (!target || (target.type !== "dotted_name" && target.type !== "identifier")) continue;
      const segs = dottedSegments(target);
      const to = resolveModule(ctx.file, segs, 0, ctx.relSet) ?? segs.join(".");
      emit.import({ from: ctx.file, to, names: [segs[segs.length - 1]] });
    }
    return;
  }
  // import_from_statement: `from <module> import a, b` or `from . import x`.
  const moduleNode = field(node, "module_name");
  let segs: string[] = [];
  let level = 0;
  if (moduleNode) {
    if (moduleNode.type === "relative_import") {
      const prefix = named(moduleNode, "import_prefix");
      level = prefix ? prefix.text.length : 1;
      const dotted = named(moduleNode, "dotted_name");
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
      const n = field(child, "name");
      if (n) names.push(dottedSegments(n)[0]);
    } else if (child.type === "dotted_name" || child.type === "identifier") {
      names.push(dottedSegments(child)[0]);
    }
  }
  const to = resolveModule(ctx.file, segs, level, ctx.relSet) ?? (segs.length ? segs.join(".") : ".");
  emit.import({ from: ctx.file, to, names });
}

function extract(root: Node, emit: Emit, ctx: Ctx): void {
  for (const raw of root.namedChildren) {
    const node = defBody(raw);

    if (node.type === "function_definition") {
      const nameNode = field(node, "name");
      if (!nameNode) continue;
      const name = nameNode.text;
      emit.symbol({ name, kind: "function", node, nameNode, exported: isPublic(name), signature: funcSig(node, name) });
    } else if (node.type === "class_definition") {
      const nameNode = field(node, "name");
      if (!nameNode) continue;
      const cname = nameNode.text;
      emit.symbol({ name: cname, kind: "class", node, nameNode, exported: isPublic(cname), signature: classSig(node, cname) });
      const body = field(node, "body");
      for (const mraw of body ? body.namedChildren : []) {
        const m = defBody(mraw);
        if (m.type !== "function_definition") continue;
        const mNameNode = field(m, "name");
        if (!mNameNode) continue;
        const mname = mNameNode.text;
        emit.symbol({ name: `${cname}.${mname}`, kind: "method", node: m, nameNode: mNameNode, exported: false, signature: funcSig(m, mname), simpleName: mname });
      }
    } else if (node.type === "expression_statement") {
      const assign = named(node, "assignment");
      const left = assign ? field(assign, "left") : undefined;
      if (!left || left.type !== "identifier") continue;
      const name = left.text;
      const kind: SymbolKind = /^[A-Z0-9_]+$/.test(name) ? "const" : "var";
      emit.symbol({ name, kind, node: left, nameNode: left, exported: isPublic(name), signature: name });
    } else if (node.type === "import_statement" || node.type === "import_from_statement") {
      collectImport(node, emit, ctx);
    }
  }
}

export const pythonParser: LanguageParser = {
  name: "python",
  extensions: ["py", "pyi"],
  build: (root, files) => buildTreeSitter(root, files, "python", extract),
};
