import type {
  SymbolInfo,
  Reference,
  FileInfo,
  ImportEdge,
} from "../../types.js";

export interface IndexContribution {
  symbols: SymbolInfo[];
  files: FileInfo[];
  imports: ImportEdge[];
  references: Record<string, Reference[]>;
}

export interface BuildOptions {

  referencesFrom?: Set<string>;

  exportsElsewhere?: Map<string, string[]>;
}

export interface LanguageParser {

  name: string;

  extensions: string[];
  build(
    root: string,
    files: string[],
    opts?: BuildOptions,
  ): Promise<IndexContribution>;
}
import { typescriptParser } from "./typescript.js";
import { pythonParser } from "./python.js";
import { goParser } from "./go.js";
import { rustParser } from "./rust.js";
import { javaParser } from "./java.js";
import { csharpParser } from "./csharp.js";
import { cParser } from "./c.js";
import { cppParser } from "./cpp.js";
import { phpParser } from "./php.js";
import { rubyParser } from "./ruby.js";
import { kotlinParser } from "./kotlin.js";

export const PARSERS: LanguageParser[] = [
  typescriptParser,
  pythonParser,
  goParser,
  rustParser,
  javaParser,
  csharpParser,
  cParser,
  cppParser,
  phpParser,
  rubyParser,
  kotlinParser,
];

const EXT_TO_PARSER = new Map<string, LanguageParser>();
for (const p of PARSERS) {
  for (const ext of p.extensions) EXT_TO_PARSER.set(ext, p);
}

export function extname(file: string): string {
  const i = file.lastIndexOf(".");
  return i === -1 ? "" : file.slice(i + 1).toLowerCase();
}

export function parserForFile(file: string): LanguageParser | undefined {
  return EXT_TO_PARSER.get(extname(file));
}

export function sourceGlob(): string {
  const exts = [...EXT_TO_PARSER.keys()].sort();
  return `**/*.{${exts.join(",")}}`;
}

export function supportedLanguages(): string {
  return PARSERS.map((p) => p.name).join(", ");
}
