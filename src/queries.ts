// The single source of truth for Sens's read-only queries.
//
// Every query is `format(engine.method(args))`. Before this module that pair was
// duplicated once in the CLI and once in the MCP server; now the CLI, the MCP
// server and the PreToolUse hook all go through `runQuery`, so usage telemetry
// and output formatting stay identical no matter which transport asked.
//
// Query names are the canonical identifiers (matching the MCP tool names) and are
// what gets written to the usage log — so a `sens who` from the terminal and a
// `who_uses` MCP call are counted as the same thing.

import { createEngine } from "./core.js";
import { logUsage } from "./usage.js";
import type { QueryEngine } from "./query/engine.js";
import {
  formatMap,
  formatSymbols,
  formatWhoUses,
  formatDeadCode,
  formatFileDependencies,
  formatExplain,
  formatPath,
} from "./format.js";

/** Argument shape for each query, keyed by its canonical name. */
export interface QueryArgs {
  project_map: { subdir?: string };
  find_symbol: { name: string };
  who_uses: { name: string; full?: boolean };
  file_outline: { file: string };
  already_exists: { query: string };
  dead_code: { subdir?: string };
  file_dependencies: { file: string };
  explain_symbol: { name: string };
  symbol_path: { from: string; to: string };
}

export type QueryName = keyof QueryArgs;

type Runner<K extends QueryName> = (engine: QueryEngine, args: QueryArgs[K]) => string;

/** Maps each query to the engine call + formatter it runs. */
const runners: { [K in QueryName]: Runner<K> } = {
  project_map: (e, a) => formatMap(e.map(a.subdir)),
  find_symbol: (e, a) => formatSymbols(e.findSymbol(a.name)),
  who_uses: (e, a) => formatWhoUses(e.whoUses(a.name), { full: a.full }),
  file_outline: (e, a) => formatSymbols(e.fileOutline(a.file)),
  already_exists: (e, a) => formatSymbols(e.alreadyExists(a.query)),
  dead_code: (e, a) => formatDeadCode(e.deadCode(a.subdir)),
  file_dependencies: (e, a) => formatFileDependencies(e.fileDependencies(a.file)),
  explain_symbol: (e, a) => formatExplain(e.explain(a.name)),
  symbol_path: (e, a) => formatPath(e.path(a.from, a.to), a.from, a.to),
};

/**
 * Run a Sens query by name: record the call, build (or reuse) the engine, and
 * return the formatted text. The one path every transport shares.
 */
export async function runQuery<K extends QueryName>(
  root: string,
  name: K,
  args: QueryArgs[K],
): Promise<string> {
  logUsage(root, name, args as Record<string, unknown>);
  const { engine } = await createEngine(root);
  return (runners[name] as Runner<K>)(engine, args);
}
