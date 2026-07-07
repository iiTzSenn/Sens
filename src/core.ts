import { buildIndex } from "./indexer/indexer.js";
import { loadIndex, saveIndex, isFresh } from "./store/store.js";
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
