import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { sensDir } from "./paths.js";

/** One recorded MCP tool call. */
export interface UsageEntry {
  /** ISO timestamp. */
  ts: string;
  /** Tool name, e.g. "dead_code". */
  tool: string;
  /** Short, human-readable summary of the arguments. */
  args: string;
}

/** Path of the append-only usage log. */
export function usagePath(root: string): string {
  return path.join(sensDir(root), "usage.jsonl");
}

/** Compact one-line summary of a tool call's arguments. */
function summarizeArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  return parts.join(" ");
}

/**
 * Record that the model called a Sens tool. Best-effort: a logging failure must
 * never break the tool call, so everything is wrapped and swallowed.
 */
export function logUsage(root: string, tool: string, args: Record<string, unknown>): void {
  try {
    mkdirSync(sensDir(root), { recursive: true });
    const entry: UsageEntry = { ts: new Date().toISOString(), tool, args: summarizeArgs(args) };
    appendFileSync(usagePath(root), JSON.stringify(entry) + "\n", "utf8");
  } catch {
    /* logging is best-effort */
  }
}

/** Read the usage log (oldest first). Missing/corrupt lines are skipped. */
export function readUsage(root: string): UsageEntry[] {
  const p = usagePath(root);
  if (!existsSync(p)) return [];
  const out: UsageEntry[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as UsageEntry);
    } catch {
      /* skip corrupt line */
    }
  }
  return out;
}

/** Human summary of the usage log: per-tool counts + the most recent calls. */
export function formatUsage(entries: UsageEntry[], recent = 15): string {
  if (entries.length === 0) {
    return "no Sens tool calls recorded yet — the model hasn't used Sens (or the MCP server hasn't run).";
  }
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.tool, (counts.get(e.tool) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const lines: string[] = [
    `${entries.length} Sens tool call(s) recorded — ${entries[0].ts} → ${entries[entries.length - 1].ts}`,
    "",
    "by tool:",
  ];
  for (const [tool, n] of ranked) lines.push(`  ${n.toString().padStart(4)}  ${tool}`);
  lines.push("", `last ${Math.min(recent, entries.length)}:`);
  for (const e of entries.slice(-recent)) {
    lines.push(`  ${e.ts}  ${e.tool}${e.args ? `  (${e.args})` : ""}`);
  }
  return lines.join("\n");
}
