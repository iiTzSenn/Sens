import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { sensDir } from "../paths.js";
import type { WatchedPath } from "../types.js";

const META_VERSION = 1;

export interface IndexMeta {
  version: number;
  indexCreatedAt: number;
  watched: WatchedPath[];
  entryPoints: string[];
}

const metaPath = (root: string): string => path.join(sensDir(root), "meta.json");

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

export function saveMeta(root: string, meta: IndexMeta): void {
  try {
    mkdirSync(sensDir(root), { recursive: true });
    writeFileSync(metaPath(root), JSON.stringify(meta), "utf8");
  } catch {

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

export function structureUnchanged(root: string, watched: WatchedPath[]): boolean {
  for (const w of watched) {
    try {
      if (statSync(path.join(root, w.path)).mtimeMs !== w.mtimeMs) return false;
    } catch {
      return false;
    }
  }
  return true;
}
