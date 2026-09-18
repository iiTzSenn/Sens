import { statSync } from "node:fs";
import path from "node:path";
import { globby } from "globby";
import { INDEX_SCHEMA_VERSION } from "../types.js";
import type { ProjectIndex, WatchedPath } from "../types.js";
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

export async function resolveWatched(
  root: string,
  ignore: string[] = [],
): Promise<WatchedPath[]> {
  const opts = {
    cwd: root,
    gitignore: true,
    absolute: false,
    ignore: [...DEFAULT_IGNORE, ...ignore],
  };
  const [dirs, ignoreFiles] = await Promise.all([
    globby("**/", { ...opts, onlyDirectories: true }),
    globby("**/.gitignore", { ...opts, dot: true }),
  ]);

  const watched: WatchedPath[] = [];
  for (const p of ["", ...dirs, ...ignoreFiles]) {

    const clean = p.replace(/\/$/, "");
    try {
      watched.push({
        path: clean,
        mtimeMs: statSync(path.join(root, clean)).mtimeMs,
      });
    } catch {

    }
  }
  return watched.sort((a, b) => a.path.localeCompare(b.path));
}

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

export async function buildIndex(
  root: string,
  opts: { ignore?: string[] } = {},
): Promise<ProjectIndex> {
  const absFiles = await resolveFiles(root, opts.ignore);

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
