import type { SymbolKind } from "../../types.js";
import type { LanguageParser } from "./parser.js";
import {
  buildTreeSitter,
  field,
  named,
  descendants,
  firstDescendant,
  type Node,
  type Emit,
  type Ctx,
} from "./treesitter/base.js";

const isPub = (node: Node): boolean => !!named(node, "visibility_modifier");

const NAMED_ITEM: Record<string, SymbolKind> = {
  function_item: "function",
  function_signature_item: "function",
  struct_item: "class",
  union_item: "class",
  enum_item: "enum",
  trait_item: "interface",
  type_item: "type",
  const_item: "const",
  static_item: "const",
};

// ---- module <-> file resolution --------------------------------------------
// Each Rust file is a module reached via `mod name;` (→ sibling `name.rs` or
// `name/mod.rs`). Items are referenced through paths (`crate::a::b::C`, `self::`,
// `super::`) or a `use` then an unqualified name. Resolving those paths to files
// lets references be import-scoped: a name match counts only against declarations
// the using file can actually see, so a same-named twin in an unreferenced module
// is correctly seen as dead. Anything we cannot resolve stays unresolved, and the
// shared scope logic falls back to broad name matching — never a false dead hit.

const dirOf = (file: string): string => {
  const i = file.lastIndexOf("/");
  return i === -1 ? "" : file.slice(0, i);
};
const baseOf = (file: string): string => {
  const i = file.lastIndexOf("/");
  return i === -1 ? file : file.slice(i + 1);
};

/** Directory that holds this file's child modules (`mod foo;` lives here). */
function childModDir(file: string): string {
  const dir = dirOf(file);
  const stem = baseOf(file).replace(/\.rs$/, "");
  // `mod.rs`/`main.rs`/`lib.rs` ARE their directory's module; other files own a
  // same-named subdirectory (`a.rs` → submodules in `a/`).
  if (stem === "mod" || stem === "main" || stem === "lib") return dir;
  return dir ? `${dir}/${stem}` : stem;
}

/** Walk `dir` up `ups` levels. */
function ancestorDir(dir: string, ups: number): string {
  let d = dir;
  for (let i = 0; i < ups; i++) d = dirOf(d);
  return d;
}

/** Directory of the crate root module (holds top-level `crate::` items). */
function crateRootDir(relSet: Set<string>): string {
  for (const r of ["src/lib.rs", "src/main.rs", "lib.rs", "main.rs"]) {
    if (relSet.has(r)) return childModDir(r);
  }
  for (const f of relSet) {
    const b = baseOf(f);
    if (b === "lib.rs" || b === "main.rs") return childModDir(f);
  }
  return "";
}

/** The file backing module path `rest` under directory `base`, or null. */
function modFile(base: string, rest: string[], relSet: Set<string>): string | null {
  if (rest.length === 0) return null;
  const joined = (base ? `${base}/` : "") + rest.join("/");
  for (const cand of [`${joined}.rs`, `${joined}/mod.rs`]) {
    if (relSet.has(cand)) return cand;
  }
  return null;
}

/** Ordered segments of a path node (`crate`/`self`/`super` kept as-is). */
function pathSegs(node: Node): string[] {
  if (!node) return [];
  const t = node.type;
  if (t === "identifier" || t === "type_identifier") return [node.text];
  if (t === "crate" || t === "self" || t === "super") return [t];
  if (t === "scoped_identifier" || t === "scoped_type_identifier") {
    return [...pathSegs(field(node, "path")), ...pathSegs(field(node, "name"))];
  }
  return [];
}

/** Split a path into its anchoring directory and the remaining module segments. */
function anchor(
  segs: string[],
  file: string,
  relSet: Set<string>,
): { base: string; rest: string[] } {
  const head = segs[0];
  if (head === "crate") return { base: crateRootDir(relSet), rest: segs.slice(1) };
  if (head === "self") return { base: childModDir(file), rest: segs.slice(1) };
  if (head === "super") {
    let ups = 0;
    while (segs[ups] === "super") ups++;
    return { base: ancestorDir(childModDir(file), ups), rest: segs.slice(ups) };
  }
  // A bare leading segment is usually an external crate; try the crate root too,
  // which only resolves when a local file actually matches (external names stay
  // unresolved → broad). Extra import edges only ever keep code alive, so this is
  // safe for precision.
  return { base: crateRootDir(relSet), rest: segs };
}

/**
 * Emit import edges for a referenced path. Both readings are tried (the trailing
 * segment as a submodule, or as an item in the parent module) so the file that
 * declares the referent is marked imported. Over-emitting is safe: a spurious
 * edge can only keep a symbol/file alive, never mark a live one dead.
 */
function importsForPath(segs: string[], ctx: Ctx, emit: Emit): void {
  if (segs.length === 0) return;
  const { base, rest } = anchor(segs, ctx.file, ctx.relSet);
  const asModule = modFile(base, rest, ctx.relSet);
  if (asModule) emit.import({ from: ctx.file, to: asModule, names: [] });
  const asItem = modFile(base, rest.slice(0, -1), ctx.relSet);
  if (asItem && asItem !== asModule) {
    emit.import({ from: ctx.file, to: asItem, names: [segs[segs.length - 1]] });
  }
}

/** Resolve `mod name;` to its file and record the module edge. */
function modDecl(name: string, ctx: Ctx, emit: Emit): void {
  const to = modFile(childModDir(ctx.file), [name], ctx.relSet);
  if (to) emit.import({ from: ctx.file, to, names: [name] });
}

// ---- entry points -----------------------------------------------------------
// Marked entries are live roots even if nothing in-project visibly calls them —
// essential to avoid false positives on runtime/FFI/test hooks.

/** Attribute that makes the item a live root (test/bench harness or FFI export). */
const isEntryAttr = (attr: string): boolean => /\b(test|bench|no_mangle)\b/.test(attr);
/** `#[cfg(test)]` gate — its whole module is test-support code. */
const isCfgTest = (attr: string): boolean => /cfg\s*\(\s*test\s*\)/.test(attr);

/** An `extern`/FFI function is called from outside the crate. */
function hasExternModifier(node: Node): boolean {
  const mods = named(node, "function_modifiers");
  return !!mods && mods.children.some((c: Node) => c.type === "extern_modifier");
}

function isEntryFn(
  node: Node,
  name: string,
  attrs: string[],
  container: string | undefined,
): boolean {
  if (container === undefined && name === "main") return true; // crate entry point
  if (attrs.some(isEntryAttr)) return true; // #[test] / #[bench] / #[no_mangle]
  return hasExternModifier(node);
}

// ---- extraction -------------------------------------------------------------

function processItem(
  node: Node,
  emit: Emit,
  ctx: Ctx,
  container: string | undefined,
  attrs: string[],
  forceEntry: boolean,
): void {
  const kind = NAMED_ITEM[node.type];
  if (kind) {
    const nameNode = field(node, "name");
    if (!nameNode) return;
    const isFn =
      node.type === "function_item" || node.type === "function_signature_item";
    const isMethod = container !== undefined && isFn;
    const name = isMethod ? `${container}.${nameNode.text}` : nameNode.text;
    const entry = isFn && (forceEntry || isEntryFn(node, nameNode.text, attrs, container));
    emit.symbol({
      name,
      kind: isMethod ? "method" : kind,
      node,
      nameNode,
      exported: isMethod ? false : isPub(node),
      simpleName: isMethod ? nameNode.text : undefined,
      entry: entry || undefined,
    });
    return;
  }
  if (node.type === "impl_item") {
    const typeNode = field(node, "type");
    const typeName =
      typeNode?.type === "type_identifier"
        ? typeNode.text
        : firstDescendant(typeNode ?? node, "type_identifier")?.text;
    const body = field(node, "body");
    processChildren(body ? body.namedChildren : [], emit, ctx, typeName ?? "impl", forceEntry);
    return;
  }
  if (node.type === "mod_item") {
    const body = field(node, "body");
    if (!body) {
      // `mod name;` — a sibling file module; wire the edge, symbols come from it.
      const nn = field(node, "name");
      if (nn) modDecl(nn.text, ctx, emit);
      return;
    }
    // inline `mod name { ... }` — a `#[cfg(test)]` gate makes it test support.
    const testMod = forceEntry || attrs.some(isCfgTest);
    processChildren(body.namedChildren, emit, ctx, container, testMod);
  }
}

/** Process a container's children, attaching preceding `#[attribute]`s to each. */
function processChildren(
  children: Node[],
  emit: Emit,
  ctx: Ctx,
  container: string | undefined,
  forceEntry: boolean,
): void {
  let attrs: string[] = [];
  for (const node of children) {
    if (node.type === "attribute_item") {
      attrs.push(node.text);
      continue;
    }
    if (node.type === "line_comment" || node.type === "block_comment") continue;
    processItem(node, emit, ctx, container, attrs, forceEntry);
    attrs = [];
  }
}

function extract(root: Node, emit: Emit, ctx: Ctx): void {
  // Import graph: every qualified path (in `use`, calls or types) that resolves
  // to a project file becomes an edge, so import-scoping sees the real module
  // dependencies. `mod name;` edges are added while walking items below.
  for (const kind of ["scoped_identifier", "scoped_type_identifier"]) {
    for (const sid of descendants(root, kind)) importsForPath(pathSegs(sid), ctx, emit);
  }
  processChildren(root.namedChildren, emit, ctx, undefined, false);
}

export const rustParser: LanguageParser = {
  name: "rust",
  extensions: ["rs"],
  // Rust has no implicit same-directory visibility: a cross-file use needs a
  // `mod`+path/`use`, and those resolve to project files — so references can be
  // import-scoped for real precision (catching same-named dead twins) while
  // unresolved paths fall back to broad matching, never a false dead hit.
  build: (root, files) => buildTreeSitter(root, files, "rust", extract, { scope: "import" }),
};
