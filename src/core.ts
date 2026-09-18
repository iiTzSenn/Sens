import { mkdirSync } from "node:fs";
import { buildIndex, resolveWatched } from "./indexer/indexer.js";
import { loadIndex, saveIndex, isFresh } from "./store/store.js";
import { loadMeta, saveMeta, buildMeta } from "./store/meta.js";
import { loadConfig, entryPointFiles, type SensConfig } from "./config.js";
import { sensDir } from "./paths.js";
import { QueryEngine } from "./query/engine.js";
import type { ProjectIndex } from "./types.js";

export interface EnsureOptions {
  force?: boolean;
  ignore?: string[];
}

/**
 * Rebuild the index and the metadata that goes with it.
 *
 * Two ordering rules matter here:
 *
 *  1. `.sens/` is created *first*. Creating it changes the root directory's
 *     mtime, and the root is a watched path — snapshotting before that would
 *     record an mtime the very next write invalidates, permanently disabling
 *     the fast path.
 *  2. The watched paths are snapshotted *before* the files are listed. A file
 *     created in between is then indexed while its directory keeps the older
 *     mtime, so the next check rescans. The reverse order would record a fresh
 *     mtime for a file that never made it into the index.
 */
async function rebuild(
  root: string,
  config: SensConfig,
  ignore: string[],
): Promise<ProjectIndex> {
  mkdirSync(sensDir(root), { recursive: true });
  const watched = await resolveWatched(root, ignore);
  const index = await buildIndex(root, { ignore });
  saveIndex(root, index);
  saveMeta(root, buildMeta(index.createdAt, watched, await entryPointFiles(root, config)));
  return index;
}

/**
 * Return a fresh project index, reusing the on-disk cache when nothing has
 * changed. Rebuilds and persists otherwise.
 */
export async function ensureIndex(
  root: string,
  opts: EnsureOptions = {},
): Promise<{ index: ProjectIndex; fromCache: boolean }> {
  const config = loadConfig(root);
  const ignore = [...(opts.ignore ?? []), ...config.ignore];
  if (!opts.force) {
    const cached = loadIndex(root);
    if (cached && (await isFresh(root, cached, ignore))) {
      return { index: cached, fromCache: true };
    }
  }
  return { index: await rebuild(root, config, ignore), fromCache: false };
}

/**
 * The project's entry-point files, read from the metadata cache when it is
 * valid. Deriving them costs a `globby` walk of its own — the second of the
 * two per-call globs the freshness work exists to avoid — and the answer only
 * changes when the file set does, which is exactly what the metadata tracks.
 */
async function entryPointsFor(
  root: string,
  config: SensConfig,
  index: ProjectIndex,
  ignore: string[],
): Promise<Set<string>> {
  const meta = loadMeta(root, index.createdAt);
  if (meta) return new Set(meta.entryPoints);

  // No usable metadata (first run after upgrading, or it was discarded).
  // Compute the entry points and lay down the cache for the next call.
  const watched = await resolveWatched(root, ignore);
  const eps = await entryPointFiles(root, config);
  saveMeta(root, buildMeta(index.createdAt, watched, eps));
  return eps;
}

/**
 * Process-lifetime cache of the last engine built per root. In a long-lived MCP
 * session the same project is queried over and over; keeping the parsed index
 * and its (map-heavy) engine in memory lets a fresh call skip re-reading and
 * re-parsing the index from disk and rebuilding every lookup structure —
 * we only run the `isFresh` check.
 *
 * The PreToolUse hook gets nothing from this: it runs as a new process per
 * tool call. That is why the on-disk metadata cache exists as well.
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

  let index: ProjectIndex | null = opts.force ? null : loadIndex(root);
  let fromCache = true;
  if (!index || !(await isFresh(root, index, ignore))) {
    index = await rebuild(root, config, ignore);
    fromCache = false;
  }

  const engine = new QueryEngine(index, await entryPointsFor(root, config, index, ignore));
  engineCache.set(root, { index, engine });
  return { engine, index, fromCache };
}
