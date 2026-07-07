import type { SymbolKind } from "../../types.js";
import type { LanguageParser } from "./parser.js";
import {
  buildTreeSitter,
  field,
  named,
  descendants,
  type Node,
  type Emit,
  type Ctx,
} from "./treesitter/base.js";

const TYPE_DECL: Record<string, SymbolKind> = {
  class_declaration: "class",
  interface_declaration: "interface",
  trait_declaration: "class",
  enum_declaration: "enum",
};

function emitType(node: Node, emit: Emit): void {
  const kind = TYPE_DECL[node.type];
  const nameNode = field(node, "name");
  if (!nameNode) return;
  const cname = nameNode.text;
  emit.symbol({ name: cname, kind, node, nameNode, exported: true });
  const body = named(node, "declaration_list");
  for (const m of body ? body.namedChildren : []) {
    if (m.type === "method_declaration") {
      const mName = field(m, "name");
      if (!mName) continue;
      emit.symbol({ name: `${cname}.${mName.text}`, kind: "method", node: m, nameNode: mName, exported: false, simpleName: mName.text });
    }
  }
}

function walk(node: Node, emit: Emit, ctx: Ctx): void {
  for (const child of node.namedChildren) {
    if (TYPE_DECL[child.type]) {
      emitType(child, emit);
    } else if (child.type === "function_definition") {
      const nameNode = field(child, "name");
      if (nameNode) emit.symbol({ name: nameNode.text, kind: "function", node: child, nameNode, exported: true });
    } else if (child.type === "const_declaration") {
      for (const el of descendants(child, "const_element")) {
        const nameNode = named(el, "name");
        if (nameNode) emit.symbol({ name: nameNode.text, kind: "const", node: el, nameNode, exported: true, signature: `const ${nameNode.text}` });
      }
    } else if (child.type === "namespace_definition") {
      const body = named(child, "compound_statement") ?? named(child, "declaration_list");
      if (body) walk(body, emit, ctx);
    } else if (child.type === "namespace_use_declaration") {
      for (const clause of descendants(child, "namespace_use_clause")) {
        const q = named(clause, "qualified_name") ?? named(clause, "name");
        if (q) emit.import({ from: ctx.file, to: q.text, names: [q.text.split("\\").pop() ?? q.text] });
      }
    }
  }
}

function extract(root: Node, emit: Emit, ctx: Ctx): void {
  walk(root, emit, ctx);
}

export const phpParser: LanguageParser = {
  name: "php",
  extensions: ["php"],
  build: (root, files) => buildTreeSitter(root, files, "php", extract),
};
