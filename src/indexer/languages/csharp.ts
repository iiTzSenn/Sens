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

/** Modifier keywords (`public`, `private`, `static`, …) on a declaration. */
const modifiers = (node: Node): string[] =>
  node.children.filter((c: Node) => c.type === "modifier").map((c: Node) => c.text);

// Only `public` is an export surface. `internal`/`protected`/`private`/default
// (default is `internal` for top-level types, `private` for members) are NOT —
// so an unused private/internal type can reach the HIGH dead-code tier.
const isPublic = (node: Node): boolean => modifiers(node).includes("public");
const isStatic = (node: Node): boolean => modifiers(node).includes("static");

/** Attribute names on a declaration (`[ApiController]`, `[HttpGet]`, …), simple
 * name only (`Foo.Bar` -> `Bar`). */
function attrs(node: Node): string[] {
  const out: string[] = [];
  for (const c of node.children) {
    if (c.type !== "attribute_list") continue;
    for (const a of c.namedChildren) {
      if (a.type !== "attribute") continue;
      const id = named(a, "identifier") ?? named(a, "qualified_name");
      if (id) out.push(id.text.split(".").pop() ?? id.text);
    }
  }
  return out;
}

const HTTP_ATTR = /^(Http(Get|Post|Put|Delete|Patch|Head|Options)|Route)$/;

/** An ASP.NET (MVC/Web API) controller: registered and dispatched by the
 * framework, so nothing in-project visibly calls it — mark it a live root to
 * avoid a false positive. Being generous here only risks a missed dead hit
 * (acceptable), never a false one. */
const isController = (node: Node, name: string): boolean =>
  name.endsWith("Controller") ||
  attrs(node).some((a) => a === "ApiController" || a === "Route");

/** A method invoked by a framework rather than in-project code: an attribute-
 * routed action (`[HttpGet]`/`[Route]`), a controller's public action, or the
 * `static Main` program entry. */
function isEntryMethod(m: Node, name: string, controller: boolean): boolean {
  if (name === "Main" && m.type === "method_declaration" && isStatic(m)) return true;
  if (controller && isPublic(m)) return true;
  return attrs(m).some((a) => HTTP_ATTR.test(a));
}

function emitType(node: Node, emit: Emit): void {
  const kind = TYPE_DECL[node.type];
  const nameNode = field(node, "name");
  if (!nameNode) return;
  const cname = nameNode.text;
  const controller = kind === "class" && isController(node, cname);
  emit.symbol({
    name: cname,
    kind,
    node,
    nameNode,
    exported: isPublic(node),
    ...(controller ? { entry: true } : {}),
  });
  const body = field(node, "body");
  for (const m of body ? body.namedChildren : []) {
    if (m.type === "method_declaration" || m.type === "constructor_declaration") {
      const mName = field(m, "name");
      if (!mName) continue;
      const entry = isEntryMethod(m, mName.text, controller);
      emit.symbol({
        name: `${cname}.${mName.text}`,
        kind: "method",
        node: m,
        nameNode: mName,
        exported: false,
        simpleName: mName.text,
        ...(entry ? { entry: true } : {}),
      });
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
  // C# namespaces are not tied to directories and same-namespace types are
  // visible across files without a `using`, so directory/import "package" scope
  // would misattribute uses and flag live code. Keep the conservative "name"
  // scope (a name match counts as a use of every same-named symbol).
  extensions: ["cs"],
  build: (root, files) => buildTreeSitter(root, files, "c_sharp", extract),
};
