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

const TYPE_ENTRY_ANNOTATIONS = new Set([
  "Component", "Service", "Repository", "Controller", "RestController",
  "Configuration", "SpringBootApplication", "ControllerAdvice",
  "RestControllerAdvice",
  "Entity", "Embeddable", "MappedSuperclass", "Table",
]);

const METHOD_ENTRY_ANNOTATIONS = new Set([
  "Bean", "EventListener", "PostConstruct", "PreDestroy", "Scheduled",
  "RequestMapping", "GetMapping", "PostMapping", "PutMapping",
  "DeleteMapping", "PatchMapping", "ExceptionHandler",
]);

const isPublic = (node: Node): boolean =>
  named(node, "modifiers")?.text.includes("public") ?? false;

function annotationNames(node: Node): Set<string> {
  const out = new Set<string>();
  const mods = named(node, "modifiers");
  if (!mods) return out;
  for (const c of mods.namedChildren) {
    if (c.type === "marker_annotation" || c.type === "annotation") {
      const n = field(c, "name");
      if (n) out.add(n.text.split(".").pop() ?? n.text);
    }
  }
  return out;
}

const hasAny = (names: Set<string>, set: Set<string>): boolean => {
  for (const n of names) if (set.has(n)) return true;
  return false;
};

function isMainMethod(m: Node): boolean {
  if (field(m, "name")?.text !== "main") return false;
  return named(m, "modifiers")?.text.includes("static") ?? false;
}

function segments(node: Node): string[] {
  return node.text.split(".").map((s: string) => s.trim()).filter(Boolean);
}

function emitType(node: Node, emit: Emit): void {
  const kind = TYPE_DECL[node.type];
  const nameNode = field(node, "name");
  if (!nameNode) return;
  const cname = nameNode.text;
  const body = field(node, "body");
  const members = body ? body.namedChildren : [];

  const typeEntry =
    hasAny(annotationNames(node), TYPE_ENTRY_ANNOTATIONS) ||
    members.some((m: Node) => m.type === "method_declaration" && isMainMethod(m));
  emit.symbol({
    name: cname,
    kind,
    node,
    nameNode,
    exported: isPublic(node),
    ...(typeEntry ? { entry: true } : {}),
  });
  for (const m of members) {
    if (m.type === "method_declaration" || m.type === "constructor_declaration") {
      const mName = field(m, "name");
      if (!mName) continue;
      const methodEntry =
        isMainMethod(m) || hasAny(annotationNames(m), METHOD_ENTRY_ANNOTATIONS);
      emit.symbol({
        name: `${cname}.${mName.text}`,
        kind: "method",
        node: m,
        nameNode: mName,
        exported: false,
        simpleName: mName.text,
        ...(methodEntry ? { entry: true } : {}),
      });
    } else if (TYPE_DECL[m.type]) {
      emitType(m, emit);
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
