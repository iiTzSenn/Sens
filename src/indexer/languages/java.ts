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

/** Framework annotations that register a TYPE with a container/runtime, so the
 * class is reachable via DI/reflection/ORM even when nothing in-project calls it
 * statically. Marking these classes as entry keeps dead-code false-positive-free
 * (a `@Service` no one constructs is not dead — Spring instantiates it). */
const TYPE_ENTRY_ANNOTATIONS = new Set([
  "Component", "Service", "Repository", "Controller", "RestController",
  "Configuration", "SpringBootApplication", "ControllerAdvice",
  "RestControllerAdvice",
  "Entity", "Embeddable", "MappedSuperclass", "Table",
]);

/** Framework annotations that register a METHOD as a runtime callback — invoked
 * reflectively by the container, never by an in-project caller. */
const METHOD_ENTRY_ANNOTATIONS = new Set([
  "Bean", "EventListener", "PostConstruct", "PreDestroy", "Scheduled",
  "RequestMapping", "GetMapping", "PostMapping", "PutMapping",
  "DeleteMapping", "PatchMapping", "ExceptionHandler",
]);

const isPublic = (node: Node): boolean =>
  named(node, "modifiers")?.text.includes("public") ?? false;

/** Simple names of the annotations applied to a declaration (its `modifiers`
 * child). `@a.b.Foo` and `@Foo("x")` both yield `Foo`. */
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

/** `public static void main(String[])` — the JVM program entry point. */
function isMainMethod(m: Node): boolean {
  if (field(m, "name")?.text !== "main") return false;
  return named(m, "modifiers")?.text.includes("static") ?? false;
}

/** Segments of a `scoped_identifier` / `identifier` (a.b.C -> [a,b,C]). */
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
  // A type is a live root when a framework annotation registers it, or when it
  // hosts `main` — its own class must not be flagged as unused.
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
      // `import a.b.C;` -> a/b/C.java. A wildcard `import a.b.*;` keeps only the
      // package path; it resolves to no single file (left as the dotted name).
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
