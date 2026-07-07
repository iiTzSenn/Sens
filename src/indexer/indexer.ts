import { statSync } from "node:fs";
import {
  Project,
  Node,
  SyntaxKind,
  type FunctionDeclaration,
  type MethodDeclaration,
  type VariableDeclaration,
} from "ts-morph";
import { globby } from "globby";
import { rel } from "../paths.js";
import type {
  ProjectIndex,
  SymbolInfo,
  Reference,
  FileInfo,
  ImportEdge,
  SymbolKind,
} from "../types.js";

const SOURCE_GLOB = "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}";
const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.sens/**",
  "**/*.d.ts",
];

/** Resolve the set of source files under `root` (respecting .gitignore). */
export async function resolveFiles(
  root: string,
  ignore: string[] = [],
): Promise<string[]> {
  const files = await globby(SOURCE_GLOB, {
    cwd: root,
    gitignore: true,
    absolute: true,
    ignore: [...DEFAULT_IGNORE, ...ignore],
  });
  return files.sort();
}

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

/** Parse `root` with ts-morph and produce a serializable project index. */
export async function buildIndex(
  root: string,
  opts: { ignore?: string[] } = {},
): Promise<ProjectIndex> {
  const absFiles = await resolveFiles(root, opts.ignore);
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
  const declToId = new Map<Node, string>();
  const nameNodes = new Set<Node>();

  const add = (
    info: SymbolInfo,
    declNode: Node,
    nameNode: Node | undefined,
  ): void => {
    symbols.push(info);
    references[info.id] = [];
    declToId.set(declNode, info.id);
    if (nameNode) nameNodes.add(nameNode);
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
      if (!sym) continue;
      const aliased = sym.getAliasedSymbol();
      if (aliased) sym = aliased;
      for (const d of sym.getDeclarations()) {
        const targetId = declToId.get(d);
        if (targetId) {
          references[targetId].push({ file, line: id.getStartLineNumber() });
          break;
        }
      }
    }
  }

  return {
    root,
    createdAt: Date.now(),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    symbols,
    references,
    imports,
  };
}
