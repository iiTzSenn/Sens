import type { SymbolKind } from "../../types.js";
import type { LanguageParser } from "./parser.js";
import {
  buildTreeSitter,
  field,
  named,
  resolveSuffix,
  type Node,
  type Emit,
  type Ctx,
} from "./treesitter/base.js";

const TYPE_DECL: Record<string, SymbolKind> = {
  class_declaration: "class",
  interface_declaration: "interface",
  enum_declaration: "enum",
  record_declaration: "class",
  annotation_type_declaration: "interface",
};

const isPublic = (node: Node): boolean =>
  named(node, "modifiers")?.text.includes("public") ?? false;

/** Segments of a `scoped_identifier` / `identifier` (a.b.C -> [a,b,C]). */
function segments(node: Node): string[] {
  return node.text.split(".").map((s: string) => s.trim()).filter(Boolean);
}

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
      emitType(m, emit); // nested type
    }
  }
}

function extract(root: Node, emit: Emit, ctx: Ctx): void {
  for (const node of root.namedChildren) {
    if (TYPE_DECL[node.type]) {
      emitType(node, emit);
    } else if (node.type === "import_declaration") {
      const scoped = named(node, "scoped_identifier") ?? named(node, "identifier");
      if (!scoped) continue;
      const segs = segments(scoped);
      const to = resolveSuffix(ctx.relSet, segs, [".java"]) ?? scoped.text;
      emit.import({ from: ctx.file, to, names: [segs[segs.length - 1]] });
    }
  }
}

export const javaParser: LanguageParser = {
  name: "java",
  extensions: ["java"],
  build: (root, files) => buildTreeSitter(root, files, "java", extract),
};
