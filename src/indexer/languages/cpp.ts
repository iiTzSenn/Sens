import type { LanguageParser } from "./parser.js";
import { buildTreeSitter, field, type Node, type Emit, type EmitSymbol } from "./treesitter/base.js";
import { cFamilyExtract } from "./treesitter/cfamily.js";

function hasStaticStorage(node: Node): boolean {
  return (
    node?.children?.some(
      (c: Node) => c.type === "storage_class_specifier" && c.text === "static",
    ) ?? false
  );
}

function inAnonymousNamespace(node: Node): boolean {
  for (let p: Node | undefined = node?.parent; p; p = p.parent) {
    if (p.type === "namespace_definition" && !field(p, "name")) return true;
  }
  return false;
}

function refine(s: EmitSymbol): EmitSymbol {
  if (s.kind === "function" && s.name === "main") return { ...s, entry: true };
  if (
    s.kind === "function" &&
    s.exported &&
    (hasStaticStorage(s.node) || inAnonymousNamespace(s.node))
  ) {
    return { ...s, exported: false };
  }
  return s;
}
export const cppParser: LanguageParser = {
  name: "cpp",

  extensions: ["cpp", "cxx", "cc", "hpp", "hh", "hxx", "h"],
  build: (root, files) =>
    buildTreeSitter(root, files, "cpp", (r, emit, ctx) => {
      const wrapped: Emit = {
        symbol: (s) => emit.symbol(refine(s)),
        import: (edge) => emit.import(edge),
      };
      cFamilyExtract(r, wrapped, ctx, { cpp: true });
    }),
};
