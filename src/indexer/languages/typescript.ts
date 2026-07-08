import { statSync } from "node:fs";
import type {
  FunctionDeclaration,
  MethodDeclaration,
  VariableDeclaration,
  Node as TsNode,
} from "ts-morph";
import { rel } from "../../paths.js";
import type {
  SymbolInfo,
  Reference,
  FileInfo,
  ImportEdge,
  SymbolKind,
} from "../../types.js";
import type { LanguageParser, IndexContribution } from "./parser.js";

function symbolId(file: string, name: string, line: number): string {
  return `${file}#${name}#${line}`;
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

function funcSig(fn: FunctionDeclaration | MethodDeclaration, name: string): string {
  const params = fn.getParameters().map((p) => collapse(p.getText())).join(", ");
  const ret = fn.getReturnTypeNode()?.getText();
  return `${name}(${params})${ret ? ": " + collapse(ret) : ""}`;
}

function varSig(v: VariableDeclaration, kind: string): string {
  const t = v.getTypeNode()?.getText();
  return `${kind} ${v.getName()}${t ? ": " + collapse(t) : ""}`;
}

/** Parse TypeScript/JavaScript files with ts-morph (semantic references).
 * ts-morph is imported lazily so a project without any JS/TS never loads it. */
async function build(root: string, absFiles: string[]): Promise<IndexContribution> {
  const { Project, Node, SyntaxKind } = await import("ts-morph");

  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: true, checkJs: false },
  });
  for (const f of absFiles) project.addSourceFileAtPath(f);

  const symbols: SymbolInfo[] = [];
  const files: FileInfo[] = [];
  const imports: ImportEdge[] = [];
  const references: Record<string, Reference[]> = {};

  // Declaration node -> symbol id, plus the set of declaration name nodes to
  // skip during the reference pass (so a definition is not counted as a use).
  const declToId = new Map<TsNode, string>();
  const nameNodes = new Set<TsNode>();

  const add = (
    info: SymbolInfo,
    declNode: TsNode,
    nameNode: TsNode | undefined,
  ): void => {
    symbols.push(info);
    references[info.id] = [];
    declToId.set(declNode, info.id);
    if (nameNode) nameNodes.add(nameNode);
  };

  // The declared symbol whose body encloses `node` (its nearest declaration
  // ancestor), or undefined at module/top-level scope. This is the "caller"
  // side of a reference edge — see Reference.from.
  const enclosingSymbolId = (node: TsNode): string | undefined => {
    for (let n = node.getParent(); n; n = n.getParent()) {
      const id = declToId.get(n);
      if (id) return id;
    }
    return undefined;
  };

  for (const sf of project.getSourceFiles()) {
    const file = rel(root, sf.getFilePath());
    const exportsList: string[] = [];

    for (const fn of sf.getFunctions()) {
      const name = fn.getName();
      if (!name) continue;
      const line = fn.getStartLineNumber();
      const exported = fn.isExported();
      if (exported) exportsList.push(name);
      add(
        { id: symbolId(file, name, line), name, kind: "function", file, line, signature: funcSig(fn, name), exported },
        fn,
        fn.getNameNode(),
      );
    }

    for (const cls of sf.getClasses()) {
      const cname = cls.getName();
      if (cname) {
        const line = cls.getStartLineNumber();
        const exported = cls.isExported();
        if (exported) exportsList.push(cname);
        add(
          { id: symbolId(file, cname, line), name: cname, kind: "class", file, line, signature: `class ${cname}`, exported },
          cls,
          cls.getNameNode(),
        );
      }
      for (const m of cls.getMethods()) {
        const mname = m.getName();
        const full = `${cname ?? "?"}.${mname}`;
        const line = m.getStartLineNumber();
        add(
          { id: symbolId(file, full, line), name: full, kind: "method", file, line, signature: funcSig(m, mname), exported: false },
          m,
          m.getNameNode(),
        );
      }
    }

    for (const v of sf.getVariableDeclarations()) {
      const name = v.getName();
      const line = v.getStartLineNumber();
      const stmt = v.getVariableStatement();
      const exported = stmt?.isExported() ?? false;
      const kind = String(stmt?.getDeclarationKind() ?? "const") as SymbolKind;
      if (exported) exportsList.push(name);
      add(
        { id: symbolId(file, name, line), name, kind, file, line, signature: varSig(v, kind), exported },
        v,
        v.getNameNode(),
      );
    }

    for (const it of sf.getInterfaces()) {
      const name = it.getName();
      const line = it.getStartLineNumber();
      const exported = it.isExported();
      if (exported) exportsList.push(name);
      add(
        { id: symbolId(file, name, line), name, kind: "interface", file, line, signature: `interface ${name}`, exported },
        it,
        it.getNameNode(),
      );
    }

    for (const ta of sf.getTypeAliases()) {
      const name = ta.getName();
      const line = ta.getStartLineNumber();
      const exported = ta.isExported();
      if (exported) exportsList.push(name);
      add(
        { id: symbolId(file, name, line), name, kind: "type", file, line, signature: `type ${name}`, exported },
        ta,
        ta.getNameNode(),
      );
    }

    for (const en of sf.getEnums()) {
      const name = en.getName();
      const line = en.getStartLineNumber();
      const exported = en.isExported();
      if (exported) exportsList.push(name);
      add(
        { id: symbolId(file, name, line), name, kind: "enum", file, line, signature: `enum ${name}`, exported },
        en,
        en.getNameNode(),
      );
    }

    for (const imp of sf.getImportDeclarations()) {
      const targetSf = imp.getModuleSpecifierSourceFile();
      const to = targetSf ? rel(root, targetSf.getFilePath()) : imp.getModuleSpecifierValue();
      const names: string[] = [];
      if (imp.getDefaultImport()) names.push("default");
      if (imp.getNamespaceImport()) names.push("*");
      for (const ni of imp.getNamedImports()) names.push(ni.getName());
      imports.push({ from: file, to, names });
    }

    files.push({ path: file, mtimeMs: statSync(sf.getFilePath()).mtimeMs, exports: exportsList });
  }

  // Single reference pass: resolve every identifier to its declaration.
  for (const sf of project.getSourceFiles()) {
    const file = rel(root, sf.getFilePath());
    for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (nameNodes.has(id)) continue;
      let sym = id.getSymbol();
      // Object shorthand `{ foo }`: the identifier resolves to the property,
      // not the referenced variable. Use the value symbol so the use counts.
      const parent = id.getParent();
      if (
        parent &&
        Node.isShorthandPropertyAssignment(parent) &&
        parent.getNameNode() === id
      ) {
        sym = parent.getValueSymbol() ?? sym;
      }
      if (!sym) continue;
      const aliased = sym.getAliasedSymbol();
      if (aliased) sym = aliased;
      for (const d of sym.getDeclarations()) {
        const targetId = declToId.get(d);
        if (targetId) {
          const from = enclosingSymbolId(id);
          references[targetId].push({
            file,
            line: id.getStartLineNumber(),
            ...(from && from !== targetId ? { from } : {}),
          });
          break;
        }
      }
    }
  }

  // Extra passes for uses TypeScript's static resolver misses, so `dead_code`
  // stops flagging code that IS used: (1) dynamic `import("./x")` — count the
  // destructured / accessed exports; (2) a string literal equal to an exported
  // name — reflective access (registries, DI, `obj["name"]`).
  const idByFileName = new Map<string, string>();
  const idsByExportedName = new Map<string, string[]>();
  for (const s of symbols) {
    const key = `${s.file}::${s.name}`;
    if (!idByFileName.has(key)) idByFileName.set(key, s.id);
    if (s.exported) {
      const list = idsByExportedName.get(s.name);
      if (list) list.push(s.id);
      else idsByExportedName.set(s.name, [s.id]);
    }
  }
  const fileSet = new Set(files.map((f) => f.path));

  /** Resolve a relative module specifier to a project file (POSIX, extensionless). */
  const resolveModule = (fromFile: string, spec: string): string | null => {
    if (!spec.startsWith(".")) return null;
    const parts = fromFile.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    const base = parts.join("/").replace(/\.[cm]?[jt]sx?$/, "");
    for (const ext of typescriptParser.extensions) {
      if (fileSet.has(`${base}.${ext}`)) return `${base}.${ext}`;
      if (fileSet.has(`${base}/index.${ext}`)) return `${base}/index.${ext}`;
    }
    return null;
  };

  /** The export names pulled out of a dynamic import, or null if not determinable. */
  const importedNames = (call: TsNode): string[] | null => {
    let node: TsNode | undefined = call.getParent();
    while (node && (Node.isAwaitExpression(node) || Node.isParenthesizedExpression(node))) {
      node = node.getParent();
    }
    if (!node) return null;
    if (Node.isPropertyAccessExpression(node)) return [node.getName()];
    if (Node.isVariableDeclaration(node)) {
      const nameNode = node.getNameNode();
      if (Node.isObjectBindingPattern(nameNode)) {
        return nameNode
          .getElements()
          .map((el) => (el.getPropertyNameNode() ?? el.getNameNode()).getText());
      }
    }
    return null;
  };

  for (const sf of project.getSourceFiles()) {
    const file = rel(root, sf.getFilePath());
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
      const arg = call.getArguments()[0];
      if (!arg || !Node.isStringLiteral(arg)) continue;
      const target = resolveModule(file, arg.getLiteralText());
      if (!target) continue;
      const line = call.getStartLineNumber();
      const names = importedNames(call);
      if (names && names.length > 0) {
        for (const n of names) {
          const tid = idByFileName.get(`${target}::${n}`);
          if (tid) references[tid].push({ file, line });
        }
      } else {
        // Namespace import (`const m = await import(...)`): can't tell which
        // exports are used, so conservatively mark them all as used.
        for (const s of symbols) {
          if (s.file === target && s.exported) references[s.id].push({ file, line });
        }
      }
    }
    for (const str of sf.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
      const val = str.getLiteralText();
      if (val.length < 3) continue;
      const ids = idsByExportedName.get(val);
      if (!ids) continue;
      const line = str.getStartLineNumber();
      for (const tid of ids) references[tid].push({ file, line });
    }
    // `export * from "./x"` (barrel re-export) re-publishes all of x's exports.
    // Named re-exports (`export { y } from "./x"`) already resolve via the
    // identifier pass; only the wildcard form needs propagating here.
    for (const exp of sf.getExportDeclarations()) {
      const targetSf = exp.getModuleSpecifierSourceFile();
      if (!targetSf || exp.getNamedExports().length > 0) continue;
      const target = rel(root, targetSf.getFilePath());
      const line = exp.getStartLineNumber();
      for (const s of symbols) {
        if (s.file === target && s.exported) references[s.id].push({ file, line });
      }
    }
  }

  return { symbols, files, imports, references };
}

export const typescriptParser: LanguageParser = {
  name: "typescript",
  extensions: ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"],
  build,
};
