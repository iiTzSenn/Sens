import { mkdirSync } from "node:fs";
import { buildIndex, resolveWatched } from "./indexer/indexer.js";
import { updateIndex } from "./indexer/incremental.js";
import { loadIndex, saveIndex, isFresh } from "./store/store.js";
import { loadMeta, saveMeta, buildMeta, structureUnchanged } from "./store/meta.js";
import { loadConfig, entryPointFiles, type SensConfig } from "./config.js";
import { sensDir } from "./paths.js";
import { QueryEngine } from "./query/engine.js";
import type { ProjectIndex, WatchedPath } from "./types.js";

const engineCache = new Map<
  string,
  { index: ProjectIndex; engine: QueryEngine }
>();

export interface EnsureOptions {
  force?: boolean;
  ignore?: string[];
}

function persist(
  root: string,
  index: ProjectIndex,
  watched: WatchedPath[],
  entryPoints: Iterable<string>,
): ProjectIndex {
  mkdirSync(sensDir(root), { recursive: true });
  saveIndex(root, index);
  saveMeta(root, buildMeta(index.createdAt, watched, entryPoints));
  engineCache.delete(root);
  return index;
}

async function rebuild(
  root: string,
  config: SensConfig,
  ignore: string[],
): Promise<ProjectIndex> {
  mkdirSync(sensDir(root), { recursive: true });
  const watched = await resolveWatched(root, ignore);
  const index = await buildIndex(root, { ignore });
  return persist(root, index, watched, await entryPointFiles(root, config));
}

export async function refreshIndex(
  root: string,
  touched: string[],
  opts: EnsureOptions = {},
): Promise<{ index: ProjectIndex; incremental: boolean }> {
  const config = loadConfig(root);
  const ignore = [...(opts.ignore ?? []), ...config.ignore];
  const previous = loadIndex(root);
  const meta = previous && loadMeta(root, previous.createdAt);
  if (previous && meta && structureUnchanged(root, meta.watched)) {
    const updated = await updateIndex(root, previous, touched);
    if (updated) {
      return {
        index: persist(root, updated, meta.watched, meta.entryPoints),
        incremental: true,
      };
    }
  }
  return { index: await rebuild(root, config, ignore), incremental: false };
}

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
async function entryPointsFor(
  root: string,
  config: SensConfig,
  index: ProjectIndex,
  ignore: string[],
): Promise<Set<string>> {
  const meta = loadMeta(root, index.createdAt);
  if (meta) return new Set(meta.entryPoints);

  const watched = await resolveWatched(root, ignore);
  const eps = await entryPointFiles(root, config);
  saveMeta(root, buildMeta(index.createdAt, watched, eps));
  return eps;
}


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
