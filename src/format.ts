// Plain-text formatters for query results, shared by the CLI and MCP server.

import type { SymbolInfo } from "./types.js";
import type { MapEntry, WhoUsesResult } from "./query/engine.js";

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

export function formatWhoUses(results: WhoUsesResult[]): string {
  if (results.length === 0) return "symbol not found";
  const lines: string[] = [];
  for (const r of results) {
    lines.push(
      `${r.symbol.name}  (${r.symbol.file}:${r.symbol.line}) — ${r.references.length} use(s)`,
    );
    for (const ref of r.references) lines.push(`  ${ref.file}:${ref.line}`);
  }
  return lines.join("\n");
}

export function formatDeadCode(syms: SymbolInfo[]): string {
  if (syms.length === 0) return "no dead-code candidates found";
  const lines: string[] = [
    `${syms.length} dead-code candidate(s) — unused; verify before deleting`,
    "",
  ];
  for (const s of syms) {
    lines.push(
      `${s.file}:${s.line}  ${s.kind} ${s.name}${s.exported ? "  [exported]" : ""}`,
    );
  }
  return lines.join("\n");
}
