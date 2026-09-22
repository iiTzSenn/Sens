import { mkdirSync } from "node:fs";
import { buildIndex, resolveFiles, resolveWatched } from "./indexer/indexer.js";
import {
  dropWarmProject,
  relativeTo,
  updateIndex,
} from "./indexer/incremental.js";
import { loadIndex, saveIndex, isFresh } from "./store/store.js";
import { loadMeta, saveMeta, buildMeta, structureUnchanged } from "./store/meta.js";
import { loadConfig, entryPointFiles, type SensConfig } from "./config.js";
import { rel, sensDir } from "./paths.js";
import { QueryEngine } from "./query/engine.js";
import type { ProjectIndex, WatchedPath } from "./types.js";

const engineCache = new Map<
  string,
  { index: ProjectIndex; engine: QueryEngine }
>();

export interface EnsureOptions {
  force?: boolean;
  ignore?: string[];
  keepWarm?: boolean;
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
  dropWarmProject(root);
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
  const done = await updateOnDisk(root, touched, config, ignore, opts.keepWarm === true);
  if (done) {
    return {
      index: persist(root, done.index, done.watched, done.entryPoints),
      incremental: true,
    };
  }
  return { index: await rebuild(root, config, ignore), incremental: false };
}

interface Refreshed {
  index: ProjectIndex;
  watched: WatchedPath[];
  entryPoints: Iterable<string>;
}

async function updateOnDisk(
  root: string,
  touched: string[],
  config: SensConfig,
  ignore: string[],
  keepWarm: boolean,
): Promise<Refreshed | null> {
  const previous = loadIndex(root);
  const meta = previous && loadMeta(root, previous.createdAt);
  if (!previous || !meta) return null;

  if (structureUnchanged(root, meta.watched)) {
    const index = await updateIndex(root, previous, touched, { keepWarm });
    return index && { index, watched: meta.watched, entryPoints: meta.entryPoints };
  }

  const present = new Set(
    (await resolveFiles(root, ignore)).map((file) => rel(root, file)),
  );
  if (!onlyWeMovedTheSet(root, previous, present, touched)) return null;

  const index = await updateIndex(root, previous, touched, { keepWarm, present });
  return (
    index && {
      index,
      watched: await resolveWatched(root, ignore),
      entryPoints: await entryPointFiles(root, config),
    }
  );
}

function onlyWeMovedTheSet(
  root: string,
  previous: ProjectIndex,
  present: Set<string>,
  touched: string[],
): boolean {
  const ours = new Set(touched.map((file) => relativeTo(root, file)));
  const known = new Set(previous.files.map((file) => file.path));
  for (const file of present) {
    if (!known.has(file) && !ours.has(file)) return false;
  }
  for (const file of known) {
    if (!present.has(file) && !ours.has(file)) return false;
  }
  return true;
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
