import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { indexPath, sensDir, rel } from "../paths.js";
import { resolveFiles, resolveWatched } from "../indexer/indexer.js";
import { loadMeta, saveMeta, structureUnchanged } from "./meta.js";
import { INDEX_SCHEMA_VERSION, type ProjectIndex } from "../types.js";

export function loadIndex(root: string): ProjectIndex | null {
  const p = indexPath(root);
  if (!existsSync(p)) return null;
  try {
    const index = JSON.parse(readFileSync(p, "utf8")) as ProjectIndex;
    if (index.schemaVersion !== INDEX_SCHEMA_VERSION) return null;
    return index;
  } catch {
    return null;
  }
}

export function saveIndex(root: string, index: ProjectIndex): void {
  mkdirSync(sensDir(root), { recursive: true });
  writeFileSync(indexPath(root), JSON.stringify(index), "utf8");
}

function filesUnchanged(root: string, index: ProjectIndex): boolean {
  for (const f of index.files) {
    try {
      if (statSync(path.join(root, f.path)).mtimeMs !== f.mtimeMs) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function isFresh(
  root: string,
  index: ProjectIndex,
  ignore: string[] = [],
): Promise<boolean> {
  const meta = loadMeta(root, index.createdAt);
  if (meta && structureUnchanged(root, meta.watched)) {
    return filesUnchanged(root, index);
  }
  const current = await resolveFiles(root, ignore);
  const prev = new Map(index.files.map((f) => [f.path, f.mtimeMs]));
  if (prev.size !== current.length) return false;
  for (const abs of current) {
    const prevMtime = prev.get(rel(root, abs));
    if (prevMtime === undefined) return false;
    if (statSync(abs).mtimeMs !== prevMtime) return false;
  }

  if (meta) {
    saveMeta(root, {
      ...meta,
      watched: await resolveWatched(root, ignore),
    });
  }
  return true;
}
