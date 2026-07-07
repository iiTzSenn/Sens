import {
  field,
  firstDescendant,
  type Node,
  type Emit,
  type Ctx,
} from "./base.js";

const NAME_TYPES = new Set(["identifier", "field_identifier", "type_identifier"]);

/** The identifier naming a function, following the `declarator` field down
 * through pointer/reference/parenthesized declarators (never into parameters). */
function fnNameNode(declarator: Node | undefined): Node | undefined {
  if (!declarator) return undefined;
  const fd = declarator.type === "function_declarator" ? declarator : firstDescendant(declarator, "function_declarator");
  if (!fd) return undefined;
  let d: Node | undefined = field(fd, "declarator");
  while (d && !NAME_TYPES.has(d.type)) {
    if (d.type === "qualified_identifier") {
      // `Ns::name` (out-of-class definition) — take the final identifier.
      return firstDescendant(d, "field_identifier") ?? firstDescendant(d, "identifier") ?? d;
    }
    const next = field(d, "declarator");
    if (!next || next === d) break;
    d = next;
  }
  return d && NAME_TYPES.has(d.type) ? d : undefined;
}

/** Emit a named struct/union/enum, returning its name (or null if anonymous). */
function emitRecord(spec: Node, emit: Emit): string | null {
  const nameNode = field(spec, "name");
  if (!nameNode || !field(spec, "body")) return null;
  const kind = spec.type === "enum_specifier" ? "enum" : "class";
  emit.symbol({ name: nameNode.text, kind, node: spec, nameNode, exported: true });
  return nameNode.text;
}

/** Methods declared inside a C++ class/struct body. */
function emitMembers(body: Node, cname: string, emit: Emit): void {
  for (const m of body.namedChildren) {
    if (m.type === "function_definition" || m.type === "declaration" || m.type === "field_declaration") {
      const nameNode = fnNameNode(field(m, "declarator"));
      if (nameNode) {
        emit.symbol({ name: `${cname}.${nameNode.text}`, kind: "method", node: m, nameNode, exported: false, simpleName: nameNode.text });
      }
    }
  }
}

export interface CFamilyOptions {
  /** Handle C++-only constructs: namespaces, classes and their methods. */
  cpp: boolean;
}

/** Shared C / C++ extractor. */
export function cFamilyExtract(root: Node, emit: Emit, ctx: Ctx, opts: CFamilyOptions): void {
  const handle = (node: Node): void => {
    switch (node.type) {
      case "function_definition":
      case "declaration": {
        const nameNode = fnNameNode(field(node, "declarator"));
        if (nameNode) {
          emit.symbol({ name: nameNode.text, kind: "function", node, nameNode, exported: true });
          return;
        }
        // A declaration may still wrap a record specifier (e.g. `struct S {...};`).
        for (const spec of ["struct_specifier", "union_specifier", "enum_specifier"]) {
          const s = firstDescendant(node, spec);
          if (s) emitRecord(s, emit);
        }
        return;
      }
      case "struct_specifier":
      case "union_specifier":
      case "enum_specifier":
        emitRecord(node, emit);
        return;
      case "type_definition": {
        const nameNode = field(node, "declarator");
        if (nameNode && nameNode.type === "type_identifier") {
          emit.symbol({ name: nameNode.text, kind: "type", node, nameNode, exported: true });
        }
        for (const spec of ["struct_specifier", "union_specifier", "enum_specifier"]) {
          const s = firstDescendant(node, spec);
          if (s && field(s, "body") && field(s, "name")) emitRecord(s, emit);
        }
        return;
      }
      case "preproc_def": {
        const nameNode = field(node, "name");
        if (nameNode) emit.symbol({ name: nameNode.text, kind: "const", node, nameNode, exported: true, signature: `#define ${nameNode.text}` });
        return;
      }
      case "preproc_function_def": {
        const nameNode = field(node, "name");
        if (nameNode) emit.symbol({ name: nameNode.text, kind: "function", node, nameNode, exported: true, signature: `#define ${nameNode.text}()` });
        return;
      }
      case "preproc_include": {
        const path = field(node, "path");
        if (path && path.type === "string_literal") {
          const rel = path.text.replace(/^"|"$/g, "");
          const segs = rel.split("/").filter(Boolean);
          const to = segs.length ? (ctx.relSet.has(rel) ? rel : findSuffix(ctx.relSet, rel)) ?? rel : rel;
          emit.import({ from: ctx.file, to, names: [] });
        }
        return;
      }
      case "class_specifier":
        if (opts.cpp) {
          const cname = emitRecord(node, emit);
          const body = field(node, "body");
          if (cname && body) emitMembers(body, cname, emit);
        }
        return;
      case "namespace_definition":
        if (opts.cpp) {
          const body = field(node, "body");
          for (const c of body ? body.namedChildren : []) handle(c);
        }
        return;
    }
  };

  for (const node of root.namedChildren) handle(node);
}

function findSuffix(relSet: Set<string>, rel: string): string | null {
  for (const r of relSet) if (r === rel || r.endsWith(`/${rel}`)) return r;
  return null;
}
