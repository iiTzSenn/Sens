import type { SymbolKind } from "../../types.js";
import type { LanguageParser } from "./parser.js";
import {
  buildTreeSitter,
  named,
  hasToken,
  firstDescendant,
  resolveSuffix,
  type Node,
  type Emit,
  type Ctx,
} from "./treesitter/base.js";

/** Kotlin is public by default; `private`/`internal`/`protected` are not part
 * of a module's usable surface, so they can reach the higher dead-code tiers.
 * Read only the declaration's own `modifiers` (a direct child) so a class isn't
 * mislabelled by one of its members' modifiers. */
const isVisible = (node: Node): boolean => {
  const mods = named(node, "modifiers");
  const v = mods ? firstDescendant(mods, "visibility_modifier")?.text : undefined;
  return v !== "private" && v !== "internal" && v !== "protected";
};

/** Framework annotations that register a declaration with a container/runtime, so
 * it is reachable via DI/reflection/the framework even when nothing in-project
 * calls it statically. Marking these as `entry` keeps dead-code false-positive
 * free (a `@Composable` no one calls is drawn by Compose; a `@Bean` is built by
 * Spring; a `@Test` is run by JUnit). Over-marking here only costs recall, never
 * precision, so the set is deliberately generous across the common JVM/Android
 * frameworks. */
const ENTRY_ANNOTATIONS = new Set([
  // Jetpack Compose — invoked by the Compose runtime / tooling.
  "Composable", "Preview",
  // Spring stereotypes & config — instantiated by the DI container.
  "Component", "Service", "Repository", "Controller", "RestController",
  "Configuration", "SpringBootApplication", "ControllerAdvice",
  "RestControllerAdvice",
  // Spring method callbacks — invoked reflectively by the container.
  "Bean", "EventListener", "PostConstruct", "PreDestroy", "Scheduled",
  "RequestMapping", "GetMapping", "PostMapping", "PutMapping",
  "DeleteMapping", "PatchMapping", "ExceptionHandler",
  // JPA / persistence — managed by the ORM.
  "Entity", "Embeddable", "MappedSuperclass", "Table",
  // JUnit lifecycle — run by the test runner (usually in *Test.kt already
  // excluded, but harmless and safe if a helper file slips through).
  "Test", "ParameterizedTest", "RepeatedTest",
  "BeforeEach", "AfterEach", "BeforeAll", "AfterAll", "Before", "After",
]);

/** Simple names of the annotations applied to a declaration (its `modifiers`
 * child). `@Composable`, `@a.b.Foo` and `@RequestMapping("/x")` each yield the
 * annotation's `type_identifier` (`Composable`, `Foo`, `RequestMapping`). */
function annotationNames(node: Node): Set<string> {
  const out = new Set<string>();
  const mods = named(node, "modifiers");
  if (!mods) return out;
  for (const c of mods.namedChildren) {
    if (c.type !== "annotation") continue;
    const ti = firstDescendant(c, "type_identifier");
    if (ti) out.add(ti.text);
  }
  return out;
}

/** A declaration registered with a framework (see {@link ENTRY_ANNOTATIONS}). */
const isEntry = (node: Node): boolean => {
  for (const n of annotationNames(node)) if (ENTRY_ANNOTATIONS.has(n)) return true;
  return false;
};

function emitClass(node: Node, emit: Emit): void {
  const nameNode = named(node, "type_identifier");
  if (!nameNode) return;
  const cname = nameNode.text;
  const kind: SymbolKind = hasToken(node, "interface") ? "interface" : "class";
  emit.symbol({ name: cname, kind, node, nameNode, exported: isVisible(node), entry: isEntry(node) });
  const body = named(node, "class_body") ?? named(node, "enum_class_body");
  for (const m of body ? body.namedChildren : []) {
    if (m.type === "function_declaration") {
      const mName = named(m, "simple_identifier");
      if (mName) emit.symbol({ name: `${cname}.${mName.text}`, kind: "method", node: m, nameNode: mName, exported: false, simpleName: mName.text, entry: isEntry(m) });
    } else if (m.type === "class_declaration" || m.type === "object_declaration") {
      emitClass(m, emit);
    }
  }
}

function extract(root: Node, emit: Emit, ctx: Ctx): void {
  for (const node of root.namedChildren) {
    switch (node.type) {
      case "function_declaration": {
        const nameNode = named(node, "simple_identifier");
        if (nameNode) {
          // `fun main(...)` is the JVM program entry point; framework-annotated
          // funs are runtime-registered. Both are live roots with no in-project
          // caller, so mark them entry to keep them out of the dead-code report.
          const entry = nameNode.text === "main" || isEntry(node);
          emit.symbol({ name: nameNode.text, kind: "function", node, nameNode, exported: isVisible(node), entry });
        }
        break;
      }
      case "class_declaration":
      case "object_declaration":
        emitClass(node, emit);
        break;
      case "property_declaration": {
        const varDecl = named(node, "variable_declaration");
        const nameNode = varDecl ? firstDescendant(varDecl, "simple_identifier") : undefined;
        if (nameNode) {
          const kind: SymbolKind = /\bvar\b/.test(node.text.slice(0, node.text.indexOf(nameNode.text) + 1)) ? "var" : "const";
          emit.symbol({ name: nameNode.text, kind, node, nameNode, exported: isVisible(node), signature: nameNode.text });
        }
        break;
      }
      case "import_list": {
        for (const header of node.namedChildren) {
          if (header.type !== "import_header") continue;
          const id = named(header, "identifier");
          if (!id) continue;
          // Kotlin imports are FQNs (`com.app.util.Helper`). Resolve to the
          // project file `com/app/util/Helper.kt` when one exists so the import
          // graph is real and cross-package uses can be scoped; otherwise keep
          // the dotted name (member/wildcard imports and file-name mismatches
          // simply fall back to broad name matching — never a false positive).
          const segs = id.text.split(".").map((s: string) => s.trim()).filter(Boolean);
          const last = segs[segs.length - 1] ?? id.text;
          const to = resolveSuffix(ctx.relSet, segs, [".kt", ".kts"]) ?? id.text;
          emit.import({ from: ctx.file, to, names: [last] });
        }
        break;
      }
    }
  }
}

/** The member half of a qualified access `recv.member` — the `simple_identifier`
 * inside a `navigation_suffix`. It targets another namespace, so it must keep the
 * broad ("name") attribution and not be narrowed to a same-named local symbol
 * (which would starve the real member and flag it as a false positive). */
function isQualifiedUse(leaf: Node): boolean {
  return leaf.parent?.type === "navigation_suffix";
}

export const kotlinParser: LanguageParser = {
  name: "kotlin",
  extensions: ["kt", "kts"],
  // Package scope: Kotlin files in the same directory (package) see each other's
  // top-level declarations without an import, so an unqualified name narrows to
  // the local package — letting a same-named top-level fun in another package be
  // flagged when only one is used. A qualified `recv.member` use stays broad
  // (isQualifiedUse) so it is never misattributed to a same-named local symbol.
  build: (root, files) =>
    buildTreeSitter(root, files, "kotlin", extract, { scope: "package", isQualifiedUse }),
};
