import type { LanguageParser } from "./parser.js";
import {
  buildTreeSitter,
  field,
  allNamed,
  descendants,
  firstDescendant,
  type Node,
  type Emit,
  type Ctx,
} from "./treesitter/base.js";

// Go exports a top-level name iff it starts with an upper-case letter.
const isExported = (name: string): boolean => /^[A-Z]/.test(name);

const unquote = (s: string): string => s.replace(/^[`"]|[`"]$/g, "");

function extract(root: Node, emit: Emit, ctx: Ctx): void {
  for (const node of root.namedChildren) {
    switch (node.type) {
      case "function_declaration": {
        const nameNode = field(node, "name");
        if (!nameNode) break;
        emit.symbol({ name: nameNode.text, kind: "function", node, nameNode, exported: isExported(nameNode.text) });
        break;
      }
      case "method_declaration": {
        const nameNode = field(node, "name");
        const recv = field(node, "receiver");
        if (!nameNode) break;
        const recvType = recv ? firstDescendant(recv, "type_identifier")?.text : undefined;
        const name = recvType ? `${recvType}.${nameNode.text}` : nameNode.text;
        emit.symbol({ name, kind: "method", node, nameNode, exported: false, simpleName: nameNode.text });
        break;
      }
      case "type_declaration": {
        for (const spec of descendants(node, "type_spec")) {
          const nameNode = field(spec, "name");
          if (!nameNode) continue;
          const t = field(spec, "type");
          const kind = t?.type === "interface_type" ? "interface" : t?.type === "struct_type" ? "class" : "type";
          emit.symbol({ name: nameNode.text, kind, node: spec, nameNode, exported: isExported(nameNode.text) });
        }
        break;
      }
      case "const_declaration":
      case "var_declaration": {
        const specType = node.type === "const_declaration" ? "const_spec" : "var_spec";
        const kind = node.type === "const_declaration" ? "const" : "var";
        for (const spec of descendants(node, specType)) {
          for (const nameNode of allNamed(spec, "identifier")) {
            emit.symbol({ name: nameNode.text, kind, node: spec, nameNode, exported: isExported(nameNode.text), signature: `${kind} ${nameNode.text}` });
          }
        }
        break;
      }
      case "import_declaration": {
        for (const spec of descendants(node, "import_spec")) {
          const path = field(spec, "path");
          if (path) emit.import({ from: ctx.file, to: unquote(path.text), names: [] });
        }
        break;
      }
    }
  }
}

export const goParser: LanguageParser = {
  name: "go",
  extensions: ["go"],
  build: (root, files) => buildTreeSitter(root, files, "go", extract),
};
