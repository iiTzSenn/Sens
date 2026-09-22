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
  id: string;
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  signature: string;
  exported: boolean;
  entry?: boolean;
}
export interface Reference {
  file: string;
  line: number;

  from?: string;
}

export interface ImportEdge {
  from: string;
  to: string;
  names: string[];
}

export interface FileInfo {
  path: string;
  mtimeMs: number;
  exports: string[];
}

export interface WatchedPath {

  path: string;
  mtimeMs: number;
}

export interface ProjectIndex {

  schemaVersion: number;
  root: string;
  createdAt: number;
  files: FileInfo[];
  symbols: SymbolInfo[];
  references: Record<string, Reference[]>;
  imports: ImportEdge[];
}
