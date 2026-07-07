import type { SymbolKind } from "../../types.js";
import type { LanguageParser } from "./parser.js";
import {
  buildTreeSitter,
  field,
  named,
  hasToken,
  firstDescendant,
  type Node,
  type Emit,
  type Ctx,
} from "./treesitter/base.js";

function emitClass(node: Node, emit: Emit): void {
  const nameNode = named(node, "type_identifier");
  if (!nameNode) return;
  const cname = nameNode.text;
  const kind: SymbolKind = hasToken(node, "interface") ? "interface" : "class";
  emit.symbol({ name: cname, kind, node, nameNode, exported: true });
  const body = named(node, "class_body") ?? named(node, "enum_class_body");
  for (const m of body ? body.namedChildren : []) {
    if (m.type === "function_declaration") {
      const mName = named(m, "simple_identifier");
      if (mName) emit.symbol({ name: `${cname}.${mName.text}`, kind: "method", node: m, nameNode: mName, exported: false, simpleName: mName.text });
    } else if (m.type === "class_declaration" || m.type === "object_declaration") {
      emitClass(m, emit);
    }
  }
}

function extract(root: Node, emit: Emit, ctx: Ctx): void {
  for (const node of root.namedChildren) {
    switch (node.type) {
      case "function_declaration": {
        const nameNode = named(node, "simple_identifier");
        if (nameNode) emit.symbol({ name: nameNode.text, kind: "function", node, nameNode, exported: true });
        break;
      }
      case "class_declaration":
      case "object_declaration":
        emitClass(node, emit);
        break;
      case "property_declaration": {
        const varDecl = named(node, "variable_declaration");
        const nameNode = varDecl ? firstDescendant(varDecl, "simple_identifier") : undefined;
        if (nameNode) {
          const kind: SymbolKind = /\bvar\b/.test(node.text.slice(0, node.text.indexOf(nameNode.text) + 1)) ? "var" : "const";
          emit.symbol({ name: nameNode.text, kind, node, nameNode, exported: true, signature: nameNode.text });
        }
        break;
      }
      case "import_list": {
        for (const header of node.namedChildren) {
          if (header.type !== "import_header") continue;
          const id = named(header, "identifier");
          if (id) emit.import({ from: ctx.file, to: id.text, names: [id.text.split(".").pop() ?? id.text] });
        }
        break;
      }
    }
  }
}

export const kotlinParser: LanguageParser = {
  name: "kotlin",
  extensions: ["kt", "kts"],
  build: (root, files) => buildTreeSitter(root, files, "kotlin", extract),
};
