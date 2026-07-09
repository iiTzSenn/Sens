import type { LanguageParser } from "./parser.js";
import { buildTreeSitter, field, type Node, type Emit, type EmitSymbol } from "./treesitter/base.js";
import { cFamilyExtract } from "./treesitter/cfamily.js";

// Reference attribution stays in the broad "name" scope: C++ overloading,
// templates (instantiations don't appear as ordinary calls), virtual dispatch
// and header/source (ODR) duplication all make same-name symbols genuinely
// ambiguous. Narrowing here would risk marking live code dead — precisely the
// one thing dead-code must never do. So the only safe wins are made per-symbol
// as the shared C/C++ extractor emits them (see `refine`).

/** True if a file-scope declaration carries the `static` storage-class
 * specifier — internal linkage in C++, so it can't be used from another TU. */
function hasStaticStorage(node: Node): boolean {
  return (
    node?.children?.some(
      (c: Node) => c.type === "storage_class_specifier" && c.text === "static",
    ) ?? false
  );
}

/** True if `node` is lexically inside an unnamed `namespace { ... }`, which
 * likewise gives its members internal linkage. */
function inAnonymousNamespace(node: Node): boolean {
  for (let p: Node | undefined = node?.parent; p; p = p.parent) {
    if (p.type === "namespace_definition" && !field(p, "name")) return true;
  }
  return false;
}

/**
 * Adjust an emitted symbol with C++ linkage knowledge the shared extractor
 * can't express:
 * - `int main(...)` is a program entry point — a live root, never flagged.
 * - A file-scope function with internal linkage (`static`, or inside an
 *   anonymous namespace) isn't externally linkable, so an unused one is truly
 *   dead: drop `exported` so it can reach HIGH instead of being capped at LOW.
 *   This only ever lowers protection for genuinely-internal, unreferenced code
 *   (a used static function still gets a same-TU reference), so it cannot turn a
 *   live symbol into a false positive.
 */
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
  // `.h` is parsed as C++ (a superset of C) so class-in-header declarations are
  // captured; pure-C `.c` files are handled by the dedicated C parser.
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
