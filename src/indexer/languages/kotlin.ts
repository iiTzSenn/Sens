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

const isVisible = (node: Node): boolean => {
  const mods = named(node, "modifiers");
  const v = mods ? firstDescendant(mods, "visibility_modifier")?.text : undefined;
  return v !== "private" && v !== "internal" && v !== "protected";
};

const ENTRY_ANNOTATIONS = new Set([

  "Composable", "Preview",
  "Component", "Service", "Repository", "Controller", "RestController",
  "Configuration", "SpringBootApplication", "ControllerAdvice",
  "RestControllerAdvice",
  "Bean", "EventListener", "PostConstruct", "PreDestroy", "Scheduled",
  "RequestMapping", "GetMapping", "PostMapping", "PutMapping",
  "DeleteMapping", "PatchMapping", "ExceptionHandler",

  "Entity", "Embeddable", "MappedSuperclass", "Table",

  "Test", "ParameterizedTest", "RepeatedTest",
  "BeforeEach", "AfterEach", "BeforeAll", "AfterAll", "Before", "After",
]);

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

function isQualifiedUse(leaf: Node): boolean {
  return leaf.parent?.type === "navigation_suffix";
}

export const kotlinParser: LanguageParser = {
  name: "kotlin",
  extensions: ["kt", "kts"],

  build: (root, files) =>
    buildTreeSitter(root, files, "kotlin", extract, { scope: "package", isQualifiedUse }),
};
