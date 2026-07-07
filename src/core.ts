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
 * Build (or reuse) the index and wrap it in a ready-to-query engine, applying
 * the project's Sens config (extra ignores + entry points).
 */
export async function createEngine(
  root: string,
  opts: EnsureOptions = {},
): Promise<{ engine: QueryEngine; index: ProjectIndex; fromCache: boolean }> {
  const config = loadConfig(root);
  const { index, fromCache } = await ensureIndex(root, {
    ...opts,
    ignore: [...(opts.ignore ?? []), ...config.ignore],
  });
  const eps = await entryPointFiles(root, config);
  return { engine: new QueryEngine(index, eps), index, fromCache };
}
