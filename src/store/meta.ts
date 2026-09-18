// Hot-path metadata: what lets a query decide "the index is still good"
// without re-walking the project.
//
// Every `sens` query pays a freshness check, and the PreToolUse hook pays it in
// a *fresh process* on every Read/Grep the model makes — so it gets no benefit
// from the in-process engine cache and the cost is fully exposed. Two globs
// dominated that check: listing every source file (to spot new ones) and
// listing the entry-point files. Both are replaced here by a `stat` of the
// watched directories (see WatchedPath), with the entry points memoized
// alongside them.
//
// Kept in `.sens/meta.json`, deliberately *outside* `index.json`:
//  - it stays small, so repairing it costs ~1ms instead of rewriting megabytes;
//  - the index format is untouched, so upgrading Sens does not invalidate
//    anyone's existing index.
//
// It is only ever a cache: a missing, stale or unreadable meta file costs a
// full scan, never a wrong answer.

import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { sensDir } from "../paths.js";
import type { WatchedPath } from "../types.js";

/** Bump when the meta shape changes; an older file is simply ignored. */
const META_VERSION = 1;

export interface IndexMeta {
  version: number;
  /**
   * `createdAt` of the index this metadata describes. If it does not match the
   * index on disk, the metadata belongs to a previous build and is discarded —
   * this is what keeps the two files consistent without a lock.
   */
  indexCreatedAt: number;
  watched: WatchedPath[];
  /** Entry-point files (see `entryPointFiles`), memoized. */
  entryPoints: string[];
}

const metaPath = (root: string): string => path.join(sensDir(root), "meta.json");

/** Read the metadata for `indexCreatedAt`, or null if absent/stale/unreadable. */
export function loadMeta(root: string, indexCreatedAt: number): IndexMeta | null {
  try {
    const meta = JSON.parse(readFileSync(metaPath(root), "utf8")) as IndexMeta;
    if (meta.version !== META_VERSION) return null;
    if (meta.indexCreatedAt !== indexCreatedAt) return null;
    if (!Array.isArray(meta.watched) || meta.watched.length === 0) return null;
    return meta;
  } catch {
    return null;
  }
}

/** Persist metadata. Best-effort: a read-only `.sens` must not fail a query. */
export function saveMeta(root: string, meta: IndexMeta): void {
  try {
    mkdirSync(sensDir(root), { recursive: true });
    writeFileSync(metaPath(root), JSON.stringify(meta), "utf8");
  } catch {
    // Cache only — losing it costs a rescan, nothing more.
  }
}

export function buildMeta(
  indexCreatedAt: number,
  watched: WatchedPath[],
  entryPoints: Iterable<string>,
): IndexMeta {
  return {
    version: META_VERSION,
    indexCreatedAt,
    watched,
    entryPoints: [...entryPoints],
  };
}

/**
 * True iff no watched path changed — i.e. nothing was added, removed or
 * renamed anywhere in the project. False the moment anything differs; the
 * caller then falls back to the full scan, which is the only thing that can
 * tell an *indexable* new file from an ignored one.
 */
export function structureUnchanged(root: string, watched: WatchedPath[]): boolean {
  for (const w of watched) {
    try {
      if (statSync(path.join(root, w.path)).mtimeMs !== w.mtimeMs) return false;
    } catch {
      return false; // removed
    }
  }
  return true;
}
