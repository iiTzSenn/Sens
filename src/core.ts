import { buildIndex } from "./indexer/indexer.js";
import { loadIndex, saveIndex, isFresh } from "./store/store.js";
import { loadConfig, entryPointFiles } from "./config.js";
import { QueryEngine } from "./query/engine.js";
import type { ProjectIndex } from "./types.js";

export interface EnsureOptions {
  force?: boolean;
  ignore?: string[];
}

/**
 * Return a fresh project index, reusing the on-disk cache when nothing has
 * changed. Rebuilds and persists otherwise.
 */
export async function ensureIndex(
  root: string,
  opts: EnsureOptions = {},
): Promise<{ index: ProjectIndex; fromCache: boolean }> {
  if (!opts.force) {
    const cached = loadIndex(root);
    if (cached && (await isFresh(root, cached, opts.ignore))) {
      return { index: cached, fromCache: true };
    }
  }
  const index = await buildIndex(root, { ignore: opts.ignore });
  saveIndex(root, index);
  return { index, fromCache: false };
}

/**
 * Process-lifetime cache of the last engine built per root. In a long-lived MCP
 * session the same project is queried over and over; keeping the parsed index
 * and its (map-heavy) engine in memory lets a fresh call skip re-reading and
 * re-parsing the index from disk and rebuilding every lookup structure —
 * we only run the cheap `isFresh` mtime check.
 */
const engineCache = new Map<
  string,
  { index: ProjectIndex; engine: QueryEngine }
>();

/**
 * Build (or reuse) the index and wrap it in a ready-to-query engine, applying
 * the project's Sens config (extra ignores + entry points).
 */
export async function createEngine(
  root: string,
  opts: EnsureOptions = {},
): Promise<{ engine: QueryEngine; index: ProjectIndex; fromCache: boolean }> {
  const config = loadConfig(root);
  const ignore = [...(opts.ignore ?? []), ...config.ignore];

  if (!opts.force) {
    const cached = engineCache.get(root);
    if (cached && (await isFresh(root, cached.index, ignore))) {
      return { engine: cached.engine, index: cached.index, fromCache: true };
    }
  }

  const { index, fromCache } = await ensureIndex(root, { ...opts, ignore });
  const eps = await entryPointFiles(root, config);
  const engine = new QueryEngine(index, eps);
  engineCache.set(root, { index, engine });
  return { engine, index, fromCache };
}
