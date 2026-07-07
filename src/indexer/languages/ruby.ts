import type { LanguageParser } from "./parser.js";
import {
  buildTreeSitter,
  field,
  named,
  type Node,
  type Emit,
  type Ctx,
} from "./treesitter/base.js";

function emitMethod(node: Node, emit: Emit, container?: string): void {
  const nameNode = field(node, "name");
  if (!nameNode) return;
  if (container) {
    emit.symbol({ name: `${container}.${nameNode.text}`, kind: "method", node, nameNode, exported: false, simpleName: nameNode.text });
  } else {
    emit.symbol({ name: nameNode.text, kind: "function", node, nameNode, exported: true });
  }
}

function processBody(body: Node, emit: Emit, ctx: Ctx, container?: string): void {
  for (const node of body.namedChildren) {
    switch (node.type) {
      case "method":
      case "singleton_method":
        emitMethod(node, emit, container);
        break;
      case "class":
      case "module": {
        const nameNode = field(node, "name");
        if (!nameNode) break;
        emit.symbol({ name: nameNode.text, kind: "class", node, nameNode, exported: true });
        const inner = field(node, "body");
        if (inner) processBody(inner, emit, ctx, nameNode.text);
        break;
      }
      case "assignment": {
        const left = field(node, "left");
        if (left && left.type === "constant") {
          emit.symbol({ name: left.text, kind: "const", node: left, nameNode: left, exported: true, signature: left.text });
        }
        break;
      }
      case "call": {
        const method = field(node, "method");
        if (method && (method.text === "require" || method.text === "require_relative")) {
          const args = field(node, "arguments");
          const str = args ? named(args, "string") : undefined;
          const raw = str ? str.text.replace(/^['"]|['"]$/g, "") : "";
          if (raw) {
            const to = method.text === "require_relative"
              ? (findSuffix(ctx.relSet, `${raw}.rb`) ?? `${raw}.rb`)
              : raw;
            emit.import({ from: ctx.file, to, names: [] });
          }
        }
        break;
      }
    }
  }
}

function findSuffix(relSet: Set<string>, rel: string): string | null {
  if (relSet.has(rel)) return rel;
  for (const r of relSet) if (r.endsWith(`/${rel}`)) return r;
  return null;
}

function extract(root: Node, emit: Emit, ctx: Ctx): void {
  processBody(root, emit, ctx);
}

export const rubyParser: LanguageParser = {
  name: "ruby",
  extensions: ["rb"],
  build: (root, files) => buildTreeSitter(root, files, "ruby", extract),
};
