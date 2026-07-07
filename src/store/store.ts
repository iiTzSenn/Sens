import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { indexPath, sensDir, rel } from "../paths.js";
import { resolveFiles } from "../indexer/indexer.js";
import { INDEX_SCHEMA_VERSION, type ProjectIndex } from "../types.js";

export function loadIndex(root: string): ProjectIndex | null {
  const p = indexPath(root);
  if (!existsSync(p)) return null;
  try {
    const index = JSON.parse(readFileSync(p, "utf8")) as ProjectIndex;
    // Discard caches written by an older/newer Sens (different index logic).
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

/**
 * A cached index is fresh iff the set of source files and each file's mtime
 * match what is on disk now. This lets repeated queries skip re-parsing.
 */
export async function isFresh(
  root: string,
  index: ProjectIndex,
  ignore: string[] = [],
): Promise<boolean> {
  const current = await resolveFiles(root, ignore);
  const prev = new Map(index.files.map((f) => [f.path, f.mtimeMs]));
  if (prev.size !== current.length) return false;
  for (const abs of current) {
    const prevMtime = prev.get(rel(root, abs));
    if (prevMtime === undefined) return false;
    if (statSync(abs).mtimeMs !== prevMtime) return false;
  }
  return true;
}
