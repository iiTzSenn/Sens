// Core data model for the Sens project index.

/** Bump when the index shape or indexing logic changes, to invalidate caches. */
export const INDEX_SCHEMA_VERSION = 6;

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
  /**
   * A runtime/framework entry point that no in-project code visibly calls but
   * is still live — e.g. Go `func main`/`init`, a WASM/JNI export, a CLI/handler
   * registered by convention. Treated as a reachability root, so it's never a
   * dead-code candidate. Set by language extractors that know the convention.
   */
  entry?: boolean;
}

export interface Reference {
  file: string;
  line: number;
  /**
   * Id of the declared symbol whose body contains this use (the "caller"),
   * or undefined when the use sits at module/top-level scope. This is what
   * turns the flat usage list into a symbol-level call graph: an edge
   * `from` → the referenced symbol.
   */
  from?: string;
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
