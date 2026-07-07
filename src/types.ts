// Core data model for the Sens project index.

/** Bump when the index shape or indexing logic changes, to invalidate caches. */
export const INDEX_SCHEMA_VERSION = 2;

export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "const"
  | "let"
  | "var"
  | "interface"
  | "type"
  | "enum"
  | "unknown";

export interface SymbolInfo {
  /** Stable id: `${file}#${name}#${line}`. */
  id: string;
  name: string;
  kind: SymbolKind;
  /** Path relative to the project root, POSIX-style. */
  file: string;
  /** 1-based line of the declaration. */
  line: number;
  /** Compact one-line signature (no body). */
  signature: string;
  exported: boolean;
}

export interface Reference {
  file: string;
  line: number;
}

export interface ImportEdge {
  /** Importing file (relative). */
  from: string;
  /** Resolved local file (relative) or bare module specifier. */
  to: string;
  /** Imported binding names ("default", "*", or named). */
  names: string[];
}

export interface FileInfo {
  path: string;
  mtimeMs: number;
  exports: string[];
}

export interface ProjectIndex {
  /** Index schema version (see INDEX_SCHEMA_VERSION). */
  schemaVersion: number;
  /** Absolute project root at build time. */
  root: string;
  createdAt: number;
  files: FileInfo[];
  symbols: SymbolInfo[];
  /** symbolId -> usage sites (excludes the declaration itself). */
  references: Record<string, Reference[]>;
  imports: ImportEdge[];
}
