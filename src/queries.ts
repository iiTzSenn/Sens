import { createEngine } from "./core.js";
import { logUsage } from "./usage.js";
import { analyzeDeadCode } from "./deadcode.js";
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

type Runner<K extends QueryName> = (
  engine: QueryEngine,
  args: QueryArgs[K],
  root: string,
) => string | Promise<string>;

const runners: { [K in QueryName]: Runner<K> } = {
  project_map: (e, a) => formatMap(e.map(a.subdir)),
  find_symbol: (e, a) => formatSymbols(e.findSymbol(a.name)),
  who_uses: (e, a) => formatWhoUses(e.whoUses(a.name), { full: a.full }),
  file_outline: (e, a) => formatSymbols(e.fileOutline(a.file)),
  already_exists: (e, a) => formatSymbols(e.alreadyExists(a.query)),
  dead_code: (e, a, root) => analyzeDeadCode(root, e, a.subdir).then(formatDeadCode),
  file_dependencies: (e, a) => formatFileDependencies(e.fileDependencies(a.file)),
  explain_symbol: (e, a) => formatExplain(e.explain(a.name)),
  symbol_path: (e, a) => formatPath(e.path(a.from, a.to), a.from, a.to),
};

export async function runQuery<K extends QueryName>(
  root: string,
  name: K,
  args: QueryArgs[K],
): Promise<string> {
  logUsage(root, name, args as Record<string, unknown>);
  const { engine } = await createEngine(root);
  return (runners[name] as Runner<K>)(engine, args, root);
}
