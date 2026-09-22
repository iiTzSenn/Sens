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

const dirOf = (file: string): string => {
  const i = file.lastIndexOf("/");
  return i === -1 ? "" : file.slice(0, i);
};
const baseOf = (file: string): string => {
  const i = file.lastIndexOf("/");
  return i === -1 ? file : file.slice(i + 1);
};

function childModDir(file: string): string {
  const dir = dirOf(file);
  const stem = baseOf(file).replace(/\.rs$/, "");
  if (stem === "mod" || stem === "main" || stem === "lib") return dir;
  return dir ? `${dir}/${stem}` : stem;
}

function ancestorDir(dir: string, ups: number): string {
  let d = dir;
  for (let i = 0; i < ups; i++) d = dirOf(d);
  return d;
}

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

function modFile(base: string, rest: string[], relSet: Set<string>): string | null {
  if (rest.length === 0) return null;
  const joined = (base ? `${base}/` : "") + rest.join("/");
  for (const cand of [`${joined}.rs`, `${joined}/mod.rs`]) {
    if (relSet.has(cand)) return cand;
  }
  return null;
}

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
  return { base: crateRootDir(relSet), rest: segs };
}

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

function modDecl(name: string, ctx: Ctx, emit: Emit): void {
  const to = modFile(childModDir(ctx.file), [name], ctx.relSet);
  if (to) emit.import({ from: ctx.file, to, names: [name] });
}

const isEntryAttr = (attr: string): boolean => /\b(test|bench|no_mangle)\b/.test(attr);
const isCfgTest = (attr: string): boolean => /cfg\s*\(\s*test\s*\)/.test(attr);

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
  if (container === undefined && name === "main") return true;
  if (attrs.some(isEntryAttr)) return true;
  return hasExternModifier(node);
}

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

      const nn = field(node, "name");
      if (nn) modDecl(nn.text, ctx, emit);
      return;
    }
    const testMod = forceEntry || attrs.some(isCfgTest);
    processChildren(body.namedChildren, emit, ctx, container, testMod);
  }
}

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

  for (const kind of ["scoped_identifier", "scoped_type_identifier"]) {
    for (const sid of descendants(root, kind)) importsForPath(pathSegs(sid), ctx, emit);
  }
  processChildren(root.namedChildren, emit, ctx, undefined, false);
}

export const rustParser: LanguageParser = {
  name: "rust",
  extensions: ["rs"],

  build: (root, files) => buildTreeSitter(root, files, "rust", extract, { scope: "import" }),
};
