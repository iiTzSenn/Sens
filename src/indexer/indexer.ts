import { globby } from "globby";
import { INDEX_SCHEMA_VERSION } from "../types.js";
import type { ProjectIndex } from "../types.js";
import {
  PARSERS,
  parserForFile,
  sourceGlob,
  type IndexContribution,
} from "./languages/parser.js";
import { disposeParsers } from "./languages/treesitter/base.js";

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.sens/**",
  "**/*.d.ts",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
];

/** Resolve the set of source files under `root` (respecting .gitignore). */
export async function resolveFiles(
  root: string,
  ignore: string[] = [],
): Promise<string[]> {
  const files = await globby(sourceGlob(), {
    cwd: root,
    gitignore: true,
    absolute: true,
    ignore: [...DEFAULT_IGNORE, ...ignore],
  });
  return files.sort();
}

/**
 * Build a serializable project index by dispatching each source file to the
 * language parser that owns it, then merging every parser's contribution.
 */
export async function buildIndex(
  root: string,
  opts: { ignore?: string[] } = {},
): Promise<ProjectIndex> {
  const absFiles = await resolveFiles(root, opts.ignore);

  // Group files by the parser that claims their extension.
  const byParser = new Map<string, string[]>();
  for (const f of absFiles) {
    const parser = parserForFile(f);
    if (!parser) continue;
    const arr = byParser.get(parser.name);
    if (arr) arr.push(f);
    else byParser.set(parser.name, [f]);
  }

  const contributions: IndexContribution[] = [];
  try {
    for (const parser of PARSERS) {
      const files = byParser.get(parser.name);
      if (!files || files.length === 0) continue;
      contributions.push(await parser.build(root, files));
    }
  } finally {
    // Release tree-sitter grammars once indexing is done (frees the emscripten
    // heap; the WASM modules themselves stay compiled until the process ends).
    await disposeParsers();
  }

  return mergeContributions(root, contributions);
}

function mergeContributions(
  root: string,
  parts: IndexContribution[],
): ProjectIndex {
  const index: ProjectIndex = {
    schemaVersion: INDEX_SCHEMA_VERSION,
    root,
    createdAt: Date.now(),
    files: [],
    symbols: [],
    references: {},
    imports: [],
  };
  for (const p of parts) {
    index.symbols.push(...p.symbols);
    index.files.push(...p.files);
    index.imports.push(...p.imports);
    Object.assign(index.references, p.references);
  }
  index.files.sort((a, b) => a.path.localeCompare(b.path));
  return index;
}
