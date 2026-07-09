// Plain-text formatters for query results, shared by the CLI and MCP server.

import type { SymbolInfo } from "./types.js";
import type {
  MapEntry,
  WhoUsesResult,
  FileDependencies,
  Neighborhood,
  DeadCodeReport,
  DeadCodeTier,
} from "./query/engine.js";

/** The declared name inside a symbol id (`file#name#line`). */
const symbolName = (id: string): string => id.split("#")[1] ?? id;

export function formatMap(entries: MapEntry[]): string {
  const lines: string[] = [`project map — ${entries.length} file(s)`, ""];
  for (const e of entries) {
    lines.push(e.file);
    for (const s of e.exported) lines.push(`  ${s.signature}`);
    if (e.internalCount > 0) lines.push(`  (+${e.internalCount} internal)`);
  }
  return lines.join("\n");
}

export function formatSymbols(syms: SymbolInfo[]): string {
  if (syms.length === 0) return "no matches";
  return syms
    .map(
      (s) =>
        `${s.file}:${s.line}  ${s.signature}${s.exported ? "  [exported]" : ""}`,
    )
    .join("\n");
}

// Above this many call sites, listing every file:line by default wastes
// tokens for a quick overview — group by file and show the busiest ones
// instead. This is a SUMMARY, not a substitute for the full list: pass
// `full: true` to get every site before doing a project-wide edit/rename,
// so a truncated view never gets mistaken for complete coverage.
const MAX_INLINE_REFS = 30;
const MAX_GROUPED_FILES = 10;

export function formatWhoUses(
  results: WhoUsesResult[],
  opts: { full?: boolean } = {},
): string {
  if (results.length === 0) return "symbol not found";
  const lines: string[] = [];
  for (const r of results) {
    lines.push(
      `${r.symbol.name}  (${r.symbol.file}:${r.symbol.line}) — ${r.references.length} use(s)`,
    );
    if (opts.full || r.references.length <= MAX_INLINE_REFS) {
      for (const ref of r.references) {
        const where = ref.from ? `  in ${symbolName(ref.from)}` : "";
        lines.push(`  ${ref.file}:${ref.line}${where}`);
      }
      continue;
    }
    const byFile = new Map<string, number>();
    for (const ref of r.references) {
      byFile.set(ref.file, (byFile.get(ref.file) ?? 0) + 1);
    }
    const sorted = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, MAX_GROUPED_FILES);
    lines.push(
      `  PARTIAL SUMMARY (not the full list) \u2014 used in ${byFile.size} file(s), busiest first:`,
    );
    for (const [file, count] of top) lines.push(`  ${file}  (${count}x)`);
    if (sorted.length > top.length) {
      lines.push(`  (+${sorted.length - top.length} more file(s) not shown)`);
    }
    lines.push(
      "  Do not treat this as complete \u2014 call who_uses again with full:true to get every " +
        "call site before renaming/editing all usages.",
    );
  }
  return lines.join("\n");
}

/** Tier headings, most-confident first. */
const DEAD_TIERS: { tier: DeadCodeTier; label: string }[] = [
  { tier: "high", label: "HIGH confidence — internal, unreferenced; safe to remove" },
  { tier: "medium", label: "MEDIUM — internal dead island; glance at the reason, then remove" },
  { tier: "low", label: "LOW — exported API or method (dynamic dispatch); verify before removing" },
];

export function formatDeadCode(report: DeadCodeReport): string {
  const { candidates, files } = report;
  if (candidates.length === 0 && files.length === 0)
    return "no dead-code candidates found";

  const deadFiles = new Set(files);
  const lines: string[] = [
    `${candidates.length} dead-code candidate(s)${files.length ? ` + ${files.length} dead file(s)` : ""} — unreachable from any entry point; candidates, not a verdict`,
  ];

  if (files.length > 0) {
    lines.push("", `WHOLE DEAD FILES — nothing imports them, no live symbol (${files.length}):`);
    for (const f of files) lines.push(`  ${f}  — delete the file`);
  }

  // Symbols inside a dead file are already covered by the file entry above.
  const loose = candidates.filter((c) => !deadFiles.has(c.symbol.file));
  for (const { tier, label } of DEAD_TIERS) {
    const group = loose.filter((c) => c.tier === tier);
    if (group.length === 0) continue;
    lines.push("", `${label} (${group.length}):`);
    for (const { symbol: s, reason, reflectiveHit } of group) {
      const warn = reflectiveHit ? ` — ⚠ also appears in ${reflectiveHit} (possible reflective use)` : "";
      lines.push(
        `  ${s.file}:${s.line}  ${s.kind} ${s.name}${s.exported ? "  [exported]" : ""}  — ${reason}${warn}`,
      );
    }
  }
  return lines.join("\n");
}

export function formatExplain(results: Neighborhood[]): string {
  if (results.length === 0) return "symbol not found";
  const lines: string[] = [];
  const block = (title: string, syms: SymbolInfo[]): void => {
    lines.push(`  ${title} (${syms.length}):`);
    if (syms.length === 0) lines.push("    (none)");
    for (const s of syms) lines.push(`    ${s.name}  ${s.file}:${s.line}`);
  };
  for (const r of results) {
    lines.push(
      `${r.symbol.name}  (${r.symbol.file}:${r.symbol.line})  ${r.symbol.signature}`,
    );
    block("called by", r.callers);
    block("calls", r.callees);
  }
  return lines.join("\n");
}

export function formatPath(
  path: SymbolInfo[] | null,
  from: string,
  to: string,
): string {
  if (!path || path.length === 0) return `no path found from ${from} to ${to}`;
  return path
    .map((s, i) => `${i === 0 ? "" : "  → "}${s.name}  (${s.file}:${s.line})`)
    .join("\n");
}

export function formatFileDependencies(deps: FileDependencies): string {
  const lines: string[] = [deps.file];
  if (deps.imports.length === 0) lines.push("  imports: (none)");
  else {
    lines.push(`  imports (${deps.imports.length}):`);
    for (const f of deps.imports) lines.push(`    ${f}`);
  }
  if (deps.importedBy.length === 0) lines.push("  imported by: (none)");
  else {
    lines.push(`  imported by (${deps.importedBy.length}):`);
    for (const f of deps.importedBy) lines.push(`    ${f}`);
  }
  return lines.join("\n");
}
