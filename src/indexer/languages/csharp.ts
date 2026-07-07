import type { SymbolKind } from "../../types.js";
import type { LanguageParser } from "./parser.js";
import {
  buildTreeSitter,
  field,
  named,
  type Node,
  type Emit,
  type Ctx,
} from "./treesitter/base.js";

const TYPE_DECL: Record<string, SymbolKind> = {
  class_declaration: "class",
  interface_declaration: "interface",
  struct_declaration: "class",
  enum_declaration: "enum",
  record_declaration: "class",
  record_struct_declaration: "class",
};

const isPublic = (node: Node): boolean =>
  named(node, "modifier_list")?.text.includes("public") ??
  node.children.some((c: Node) => c.type === "modifier" && c.text === "public");

function emitType(node: Node, emit: Emit): void {
  const kind = TYPE_DECL[node.type];
  const nameNode = field(node, "name");
  if (!nameNode) return;
  const cname = nameNode.text;
  emit.symbol({ name: cname, kind, node, nameNode, exported: isPublic(node) });
  const body = field(node, "body");
  for (const m of body ? body.namedChildren : []) {
    if (m.type === "method_declaration" || m.type === "constructor_declaration") {
      const mName = field(m, "name");
      if (!mName) continue;
      emit.symbol({ name: `${cname}.${mName.text}`, kind: "method", node: m, nameNode: mName, exported: false, simpleName: mName.text });
    } else if (TYPE_DECL[m.type]) {
      emitType(m, emit);
    }
  }
}

function walk(node: Node, emit: Emit, ctx: Ctx): void {
  for (const child of node.namedChildren) {
    if (TYPE_DECL[child.type]) {
      emitType(child, emit);
    } else if (child.type === "namespace_declaration" || child.type === "file_scoped_namespace_declaration") {
      const body = field(child, "body") ?? child;
      walk(body, emit, ctx);
    } else if (child.type === "using_directive") {
      const name = named(child, "qualified_name") ?? named(child, "identifier");
      if (name) emit.import({ from: ctx.file, to: name.text, names: [name.text.split(".").pop() ?? name.text] });
    }
  }
}

function extract(root: Node, emit: Emit, ctx: Ctx): void {
  walk(root, emit, ctx);
}

export const csharpParser: LanguageParser = {
  name: "csharp",
  extensions: ["cs"],
  build: (root, files) => buildTreeSitter(root, files, "c_sharp", extract),
};
