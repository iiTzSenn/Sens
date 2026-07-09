import type { LanguageParser } from "./parser.js";
import {
  buildTreeSitter,
  field,
  named,
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

/** The `package` name of a source file (`package main` -> "main"), or undefined. */
function packageName(root: Node): string | undefined {
  const clause = named(root, "package_clause");
  return clause ? firstDescendant(clause, "package_identifier")?.text : undefined;
}

function extract(root: Node, emit: Emit, ctx: Ctx): void {
  const pkg = packageName(root);
  for (const node of root.namedChildren) {
    switch (node.type) {
      case "function_declaration": {
        const nameNode = field(node, "name");
        if (!nameNode) break;
        const fname = nameNode.text;
        // Runtime entry points Go invokes itself, with no visible in-project
        // caller: `main` in `package main`, and any `init`. Marking them entry
        // keeps them out of the dead-code report (they'd otherwise be HIGH).
        const entry = fname === "init" || (fname === "main" && pkg === "main");
        emit.symbol({ name: fname, kind: "function", node, nameNode, exported: isExported(fname), entry });
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

/** The member half of a qualified access `pkg.Name` — the `field` child of a
 * selector_expression. These target another namespace, so they must keep the
 * broad ("name") attribution and not be narrowed to a same-named local symbol. */
function isQualifiedUse(leaf: Node): boolean {
  const parent = leaf.parent;
  return (
    parent?.type === "selector_expression" &&
    field(parent, "field")?.startIndex === leaf.startIndex
  );
}

export const goParser: LanguageParser = {
  name: "go",
  extensions: ["go"],
  // Package scope: files in the same directory (package) see each other without
  // imports, so an unqualified name narrows to the local package — letting a
  // same-named func in another package be flagged when only one is used. A
  // qualified `pkg.Name` use stays broad (isQualifiedUse) so it never gets
  // misattributed to a same-named local symbol, which would be a false positive.
  build: (root, files) =>
    buildTreeSitter(root, files, "go", extract, { scope: "package", isQualifiedUse }),
};
