import type { SymbolKind } from "../../types.js";
import type { LanguageParser } from "./parser.js";
import {
  buildTreeSitter,
  field,
  named,
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

function processItem(node: Node, emit: Emit, container?: string): void {
  const kind = NAMED_ITEM[node.type];
  if (kind) {
    const nameNode = field(node, "name");
    if (!nameNode) return;
    const isMethod = container !== undefined && (node.type === "function_item" || node.type === "function_signature_item");
    const name = isMethod ? `${container}.${nameNode.text}` : nameNode.text;
    emit.symbol({
      name,
      kind: isMethod ? "method" : kind,
      node,
      nameNode,
      exported: isMethod ? false : isPub(node),
      simpleName: isMethod ? nameNode.text : undefined,
    });
    return;
  }
  if (node.type === "impl_item") {
    const typeNode = field(node, "type");
    const typeName = typeNode?.type === "type_identifier" ? typeNode.text : firstDescendant(typeNode ?? node, "type_identifier")?.text;
    const body = field(node, "body");
    for (const child of body ? body.namedChildren : []) processItem(child, emit, typeName ?? "impl");
    return;
  }
  if (node.type === "mod_item") {
    const body = field(node, "body");
    for (const child of body ? body.namedChildren : []) processItem(child, emit, container);
  }
}

function extract(root: Node, emit: Emit, ctx: Ctx): void {
  for (const node of root.namedChildren) {
    if (node.type === "use_declaration") {
      const arg = field(node, "argument");
      const last = arg ? (firstDescendant(arg, "identifier")?.text ?? arg.text) : undefined;
      emit.import({ from: ctx.file, to: arg ? arg.text : "", names: last ? [last] : [] });
      continue;
    }
    processItem(node, emit);
  }
}

export const rustParser: LanguageParser = {
  name: "rust",
  extensions: ["rs"],
  build: (root, files) => buildTreeSitter(root, files, "rust", extract),
};
