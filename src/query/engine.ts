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

/** A symbol and its immediate neighbors in the call/reference graph. */
export interface Neighborhood {
  symbol: SymbolInfo;
  /** Declared symbols whose body references this one. */
  callers: SymbolInfo[];
  /** Declared symbols this one references from its own body. */
  callees: SymbolInfo[];
}

/** How confident we are that a dead-code candidate is safe to remove. */
export type DeadCodeTier = "high" | "medium" | "low";

/** An unreachable symbol, with why it surfaced and how much to trust it. */
export interface DeadCodeCandidate {
  symbol: SymbolInfo;
  tier: DeadCodeTier;
  /** Plain-language explanation of the tier — what the model/user should check. */
  reason: string;
  /** A non-source file that mentions this name (set by the reflective scan) —
   * a warning that it may be wired up dynamically, so don't blindly delete it. */
  reflectiveHit?: string;
}

/** The dead-code picture for a scope: per-symbol candidates + whole dead files. */
export interface DeadCodeReport {
  candidates: DeadCodeCandidate[];
  /** Files where every symbol is unreachable and nothing imports the file — the
   * whole module is dead, so it's cleaner to delete the file than each symbol. */
  files: string[];
}

const TIER_RANK: Record<DeadCodeTier, number> = { high: 0, medium: 1, low: 2 };

/**
 * Answers the Sens queries over a built project index. All lookup structures
 * (name/file/id maps, the import adjacency and the symbol-level call graph) are
 * built once in the constructor, so repeated queries are O(1)/O(neighbors)
 * instead of scanning every symbol per call.
 */
export class QueryEngine {
  private readonly byId = new Map<string, SymbolInfo>();
  private readonly byNameLower = new Map<string, SymbolInfo[]>();
  /** Keyed by full name and by the part after the last `.`, for who_uses/explain. */
  private readonly byNameOrSuffix = new Map<string, SymbolInfo[]>();
  private readonly byFile = new Map<string, SymbolInfo[]>();
  private readonly fileSet: Set<string>;
  private readonly importsFrom = new Map<string, Set<string>>();
  private readonly importsTo = new Map<string, Set<string>>();
  /** symbolId -> symbols it references (call graph, directed). */
  private readonly calleesOf = new Map<string, Set<string>>();
  /** symbolId -> symbols that reference it. */
  private readonly callersOf = new Map<string, Set<string>>();

  constructor(
    private readonly index: ProjectIndex,
    private readonly entryPoints: Set<string> = new Set(),
  ) {
    this.fileSet = new Set(index.files.map((f) => f.path));

    for (const s of index.symbols) {
      this.byId.set(s.id, s);
      push(this.byNameLower, s.name.toLowerCase(), s);
      push(this.byNameOrSuffix, s.name, s);
      const dot = s.name.lastIndexOf(".");
      if (dot !== -1) push(this.byNameOrSuffix, s.name.slice(dot + 1), s);
      push(this.byFile, s.file, s);
    }

    for (const imp of index.imports) {
      if (imp.from === imp.to) continue;
      if (this.fileSet.has(imp.to)) add(this.importsFrom, imp.from, imp.to);
      add(this.importsTo, imp.to, imp.from);
    }

    // Symbol-level call graph: a reference with a `from` is an edge
    // caller -> referenced symbol.
    for (const [targetId, refs] of Object.entries(index.references)) {
      for (const ref of refs) {
        if (!ref.from || ref.from === targetId) continue;
        add(this.calleesOf, ref.from, targetId);
        add(this.callersOf, targetId, ref.from);
      }
    }
  }

  /** Exact (case-insensitive) symbol lookup. */
  findSymbol(name: string): SymbolInfo[] {
    return this.byNameLower.get(name.toLowerCase()) ?? [];
  }

  /** Symbols matching `name` bare or as `Class.method`. */
  private resolve(name: string): SymbolInfo[] {
    return this.byNameOrSuffix.get(name) ?? [];
  }

  /** Usage sites for every symbol matching `name` (bare or `Class.method`). */
  whoUses(name: string): WhoUsesResult[] {
    return this.resolve(name).map((s) => ({
      symbol: s,
      references: this.index.references[s.id] ?? [],
    }));
  }

  /**
   * A symbol's neighbors in the call graph: what references it (callers) and
   * what it references (callees). Lets a caller pull just the relevant slice of
   * the codebase instead of reading whole files.
   */
  explain(name: string): Neighborhood[] {
    return this.resolve(name).map((s) => ({
      symbol: s,
      callers: this.neighbors(this.callersOf.get(s.id)),
      callees: this.neighbors(this.calleesOf.get(s.id)),
    }));
  }

  private neighbors(ids: Set<string> | undefined): SymbolInfo[] {
    if (!ids) return [];
    const out: SymbolInfo[] = [];
    for (const id of ids) {
      const s = this.byId.get(id);
      if (s) out.push(s);
    }
    return out.sort(byFileLine);
  }

  /**
   * Shortest connection between any symbol named `a` and any named `b` over the
   * (undirected) call graph — "how does X reach Y". Returns the chain of symbols
   * from an `a` to a `b`, or null if they are not connected.
   */
  path(a: string, b: string): SymbolInfo[] | null {
    const sources = this.resolve(a);
    const targets = new Set(this.resolve(b).map((s) => s.id));
    if (sources.length === 0 || targets.size === 0) return null;

    const prev = new Map<string, string | null>();
    const queue: string[] = [];
    for (const s of sources) {
      if (prev.has(s.id)) continue;
      prev.set(s.id, null);
      queue.push(s.id);
    }

    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (targets.has(id)) return this.rebuild(prev, id);
      for (const n of this.undirectedNeighbors(id)) {
        if (prev.has(n)) continue;
        prev.set(n, id);
        queue.push(n);
      }
    }
    return null;
  }

  private *undirectedNeighbors(id: string): Iterable<string> {
    yield* this.calleesOf.get(id) ?? [];
    yield* this.callersOf.get(id) ?? [];
  }

  private rebuild(prev: Map<string, string | null>, end: string): SymbolInfo[] {
    const ids: string[] = [];
    for (let cur: string | null = end; cur; cur = prev.get(cur) ?? null) ids.push(cur);
    ids.reverse();
    return ids.map((id) => this.byId.get(id)).filter((s): s is SymbolInfo => !!s);
  }

  /** Symbols declared in a file (matched by suffix), ordered by line. */
  fileOutline(file: string): SymbolInfo[] {
    const norm = file.replace(/\\/g, "/");
    const exact = this.byFile.get(norm);
    const syms = exact ?? this.index.symbols.filter((s) => s.file.endsWith(norm));
    return [...syms].sort((a, b) => a.line - b.line);
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
    const entries: MapEntry[] = [];
    for (const [file, syms] of this.byFile) {
      if (sub && !file.startsWith(sub)) continue;
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
    return {
      file: target,
      imports: [...(this.importsFrom.get(target) ?? [])].sort(),
      importedBy: [...(this.importsTo.get(target) ?? [])].sort(),
    };
  }

  /**
   * Mark-and-sweep over the call graph from a caller-supplied set of roots:
   * seed the roots, then propagate along callee edges (if a live symbol's body
   * runs, so do the symbols it calls). Unknown ids are ignored.
   */
  private mark(seedRoots: (seed: (id: string) => void) => void): Set<string> {
    const live = new Set<string>();
    const stack: string[] = [];
    const seed = (id: string): void => {
      if (this.byId.has(id) && !live.has(id)) {
        live.add(id);
        stack.push(id);
      }
    };
    seedRoots(seed);
    while (stack.length) {
      const id = stack.pop() as string;
      for (const callee of this.calleesOf.get(id) ?? []) seed(callee);
    }
    return live;
  }

  /**
   * Two reachability views over the call graph:
   *
   * - `real`: reached from genuine program roots — the public API of
   *   entry-point files, everything in test files, and any symbol used at
   *   module/reflective scope (a reference with no enclosing `from`: a top-level
   *   statement, a `string`-keyed lookup or a dynamic `import()`). An export
   *   *not* in `real` is an unused export.
   * - `live`: `real` plus every export treated as a potential external entry
   *   point. Because we can't see callers outside the index, a helper reached
   *   only through an (even unused) export is spared here. What falls outside
   *   `live` is code reachable from nothing at all — a true internal dead island.
   *
   * Both are conservative: a `from`-less use always seeds a root, so neither can
   * mark genuinely-live code as dead.
   */
  private reachableSymbols(): { real: Set<string>; live: Set<string> } {
    const real = this.mark((seed) => {
      for (const s of this.index.symbols) {
        if (s.entry) seed(s.id); // runtime/framework entry point (Go main, …)
        else if (s.exported && this.entryPoints.has(s.file)) seed(s.id);
        else if (isTestFile(s.file)) seed(s.id);
      }
      for (const [id, refs] of Object.entries(this.index.references)) {
        if (refs.some((r) => !r.from)) seed(id);
      }
    });
    const live = this.mark((seed) => {
      real.forEach(seed);
      for (const s of this.index.symbols) if (s.exported) seed(s.id);
    });
    return { real, live };
  }

  /**
   * Dead-code candidates ranked by how safe they are to remove. Beyond a plain
   * "zero references" filter this also finds dead islands — clusters that only
   * reference each other yet are reachable from nothing. Excludes methods, tests
   * and entry-point exports.
   *
   * - HIGH: internal symbol with no references anywhere.
   * - MEDIUM: internal, reached only from other unreachable code (dead island).
   * - LOW: an unused export — might be public API consumed outside the index, so
   *   always needs a human check.
   */
  deadCodeReport(subdir?: string): DeadCodeReport {
    const sub = subdir?.replace(/\\/g, "/");
    const { real, live } = this.reachableSymbols();
    const inScope = (file: string): boolean => !sub || file.startsWith(sub);

    const candidates: DeadCodeCandidate[] = [];
    for (const s of this.index.symbols) {
      if (!inScope(s.file)) continue;
      if (isTestFile(s.file)) continue;
      if (s.exported && this.entryPoints.has(s.file)) continue;
      const refs = this.index.references[s.id]?.length ?? 0;
      if (s.kind === "method") {
        // Methods resolve poorly under polymorphism/interfaces, so a "dead"
        // method is the least certain signal — never above LOW.
        if (live.has(s.id)) continue;
        candidates.push({
          symbol: s,
          tier: "low",
          reason: "method unreferenced statically — interfaces/dynamic dispatch may still call it; verify",
        });
      } else if (s.exported) {
        if (real.has(s.id)) continue; // used somewhere in-project
        candidates.push({
          symbol: s,
          tier: "low",
          reason:
            refs === 0
              ? "exported but never referenced in-project — safe only if it isn't public API"
              : "exported and reached only from other dead code — verify it isn't public API",
        });
      } else {
        if (live.has(s.id)) continue; // reached from a root or via some export
        candidates.push({
          symbol: s,
          tier: refs === 0 ? "high" : "medium",
          reason:
            refs === 0
              ? "internal symbol with no references anywhere"
              : "internal, reached only from other unreachable code (dead island)",
        });
      }
    }
    candidates.sort(
      (a, b) =>
        TIER_RANK[a.tier] - TIER_RANK[b.tier] || byFileLine(a.symbol, b.symbol),
    );

    // A whole module is dead when nothing imports it and none of its symbols is
    // live even after exports are treated as roots (so no external surface).
    const files: string[] = [];
    for (const [file, syms] of this.byFile) {
      if (!inScope(file) || isTestFile(file) || this.entryPoints.has(file)) continue;
      if ((this.importsTo.get(file)?.size ?? 0) > 0) continue;
      if (syms.length > 0 && syms.every((s) => !live.has(s.id))) files.push(file);
    }
    files.sort();

    return { candidates, files };
  }

  /** Unused symbols (candidates), symbol-only view of {@link deadCodeReport}. */
  deadCode(subdir?: string): SymbolInfo[] {
    return this.deadCodeReport(subdir).candidates.map((c) => c.symbol);
  }
}

function push<K>(map: Map<K, SymbolInfo[]>, key: K, s: SymbolInfo): void {
  const list = map.get(key);
  if (list) list.push(s);
  else map.set(key, [s]);
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

function byFileLine(a: SymbolInfo, b: SymbolInfo): number {
  return a.file.localeCompare(b.file) || a.line - b.line;
}
