import type {
  SymbolInfo,
  Reference,
  FileInfo,
  ImportEdge,
} from "../../types.js";

/**
 * What a single language parser contributes to the project index: the symbols
 * it found, per-file metadata, the import edges between files, and the resolved
 * usage sites (`symbolId -> references`). Contributions from every language are
 * merged into one {@link ProjectIndex}.
 */
export interface IndexContribution {
  symbols: SymbolInfo[];
  files: FileInfo[];
  imports: ImportEdge[];
  references: Record<string, Reference[]>;
}

/**
 * A pluggable per-language indexer. Sens started as TypeScript-only; a parser
 * owns a set of file extensions and turns those files into an
 * {@link IndexContribution}. New languages plug in by adding a parser to
 * {@link PARSERS} — nothing downstream (query engine, formatters, dashboard)
 * needs to know which language a symbol came from.
 */
export interface LanguageParser {
  /** Human-readable id, e.g. "typescript" or "python". */
  name: string;
  /** Extensions this parser claims, lower-case, without the dot. */
  extensions: string[];
  /** Parse `files` (absolute paths, all owned by this parser) under `root`. */
  build(root: string, files: string[]): Promise<IndexContribution>;
}

import { typescriptParser } from "./typescript.js";
import { pythonParser } from "./python.js";

/** All languages Sens can index. Order is not significant. */
export const PARSERS: LanguageParser[] = [typescriptParser, pythonParser];

const EXT_TO_PARSER = new Map<string, LanguageParser>();
for (const p of PARSERS) {
  for (const ext of p.extensions) EXT_TO_PARSER.set(ext, p);
}

/** Lower-case extension (without dot) of a path, or "" if none. */
export function extname(file: string): string {
  const i = file.lastIndexOf(".");
  return i === -1 ? "" : file.slice(i + 1).toLowerCase();
}

/** The parser that owns a file, or undefined if no language claims it. */
export function parserForFile(file: string): LanguageParser | undefined {
  return EXT_TO_PARSER.get(extname(file));
}

/**
 * A single globby brace pattern matching every extension any parser claims,
 * e.g. `**\/*.{ts,tsx,js,py}`. Used to resolve the candidate source set.
 */
export function sourceGlob(): string {
  const exts = [...EXT_TO_PARSER.keys()].sort();
  return `**/*.{${exts.join(",")}}`;
}

/** Human list of supported languages, for help/warning messages. */
export function supportedLanguages(): string {
  return PARSERS.map((p) => p.name).join(", ");
}
