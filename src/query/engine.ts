import type { ProjectIndex, SymbolInfo, Reference } from "../types.js";
import { isTestFile } from "../config.js";

export interface WhoUsesResult {
  symbol: SymbolInfo;
  references: Reference[];
}

export interface MapEntry {
  file: string;
  exported: SymbolInfo[];
  internalCount: number;
}

export interface FileDependencies {
  file: string;
  /** Files this file imports (internal, resolved). */
  imports: string[];
  /** Files that import this file (internal, resolved). */
  importedBy: string[];
}

/** Answers the six Sens queries over a built project index. */
export class QueryEngine {
  constructor(
    private readonly index: ProjectIndex,
    private readonly entryPoints: Set<string> = new Set(),
  ) {}

  /** Exact (case-insensitive) symbol lookup. */
  findSymbol(name: string): SymbolInfo[] {
    const q = name.toLowerCase();
    return this.index.symbols.filter((s) => s.name.toLowerCase() === q);
  }

  /** Usage sites for every symbol matching `name` (bare or `Class.method`). */
  whoUses(name: string): WhoUsesResult[] {
    return this.index.symbols
      .filter((s) => s.name === name || s.name.endsWith(`.${name}`))
      .map((s) => ({
        symbol: s,
        references: this.index.references[s.id] ?? [],
      }));
  }

  /** Symbols declared in a file (matched by suffix), ordered by line. */
  fileOutline(file: string): SymbolInfo[] {
    const norm = file.replace(/\\/g, "/");
    return this.index.symbols
      .filter((s) => s.file === norm || s.file.endsWith(norm))
      .sort((a, b) => a.line - b.line);
  }

  /** Rank existing symbols against keywords, to encourage reuse over dup. */
  alreadyExists(query: string, limit = 15): SymbolInfo[] {
    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return [];
    return this.index.symbols
      .map((s) => ({ s, score: this.score(s, keywords) }))
      .filter((x) => x.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || Number(b.s.exported) - Number(a.s.exported),
      )
      .slice(0, limit)
      .map((x) => x.s);
  }

  private score(s: SymbolInfo, keywords: string[]): number {
    const name = s.name.toLowerCase();
    const hay = `${s.name} ${s.signature}`.toLowerCase();
    let score = 0;
    for (const k of keywords) {
      if (name === k) score += 10;
      else if (name.includes(k)) score += 4;
      else if (hay.includes(k)) score += 1;
    }
    if (score > 0 && s.exported) score += 0.5;
    return score;
  }

  /** Compact per-file map (exported symbols + internal count). */
  map(subdir?: string): MapEntry[] {
    const sub = subdir?.replace(/\\/g, "/");
    const byFile = new Map<string, SymbolInfo[]>();
    for (const s of this.index.symbols) {
      if (sub && !s.file.startsWith(sub)) continue;
      let arr = byFile.get(s.file);
      if (!arr) {
        arr = [];
        byFile.set(s.file, arr);
      }
      arr.push(s);
    }
    const entries: MapEntry[] = [];
    for (const [file, syms] of byFile) {
      const exported = syms
        .filter((s) => s.exported && s.kind !== "method")
        .sort((a, b) => a.line - b.line);
      entries.push({ file, exported, internalCount: syms.length - exported.length });
    }
    return entries.sort((a, b) => a.file.localeCompare(b.file));
  }

  /**
   * A file's neighbors in the (precomputed) import graph: what it imports
   * and what imports it. Lets a caller jump straight to related files
   * instead of grepping or reading the whole project.
   */
  fileDependencies(file: string): FileDependencies {
    const norm = file.replace(/\\/g, "/");
    const target =
      this.index.files.find((f) => f.path === norm || f.path.endsWith(norm))
        ?.path ?? norm;
    const fileSet = new Set(this.index.files.map((f) => f.path));
    const imports = [
      ...new Set(
        this.index.imports
          .filter((i) => i.from === target && i.to !== target && fileSet.has(i.to))
          .map((i) => i.to),
      ),
    ].sort();
    const importedBy = [
      ...new Set(
        this.index.imports
          .filter((i) => i.to === target && i.from !== target)
          .map((i) => i.from),
      ),
    ].sort();
    return { file: target, imports, importedBy };
  }

  /** Unused symbols (candidates). Excludes methods, tests, entry-point exports. */
  deadCode(subdir?: string): SymbolInfo[] {
    const sub = subdir?.replace(/\\/g, "/");
    return this.index.symbols.filter((s) => {
      if (sub && !s.file.startsWith(sub)) return false;
      if ((this.index.references[s.id]?.length ?? 0) > 0) return false;
      if (s.kind === "method") return false;
      if (isTestFile(s.file)) return false;
      if (s.exported && this.entryPoints.has(s.file)) return false;
      return true;
    });
  }
}
