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

/** True iff every indexed file still exists with the mtime it was indexed at. */
function filesUnchanged(root: string, index: ProjectIndex): boolean {
  for (const f of index.files) {
    try {
      if (statSync(path.join(root, f.path)).mtimeMs !== f.mtimeMs) return false;
    } catch {
      return false; // deleted
    }
  }
  return true;
}

/**
 * A cached index is fresh iff the set of source files and each file's mtime
 * match what is on disk now. This lets repeated queries skip re-parsing.
 *
 * Two paths, same answer:
 *
 *  - **Fast path** — stat the watched directories, then the indexed files. An
 *    added/removed/renamed file shows up as a directory mtime change; a content
 *    edit shows up as a file mtime change. This is pure `stat`, so it costs
 *    ~25ms on a 1k-file project instead of the ~60-120ms a full `globby` walk
 *    costs (most of which is .gitignore matching). It matters because the
 *    PreToolUse hook pays this on *every* Read/Grep the model makes, in a fresh
 *    process that gets no benefit from the engine cache.
 *
 *  - **Full scan** — used when there is no usable metadata, or when the
 *    structure did change and we need to know whether the changed entry is
 *    actually an indexable source file (a new `.log` or a gitignored build
 *    artifact bumps a directory's mtime but must not force a reindex).
 *
 * The fast path never reports fresh when the full scan would report stale: it
 * only skips work when nothing on disk moved at all.
 */
export async function isFresh(
  root: string,
  index: ProjectIndex,
  ignore: string[] = [],
): Promise<boolean> {
  // Structure first: it is the cheaper of the two checks, and when it fails
  // the full scan below re-stats every file anyway.
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

  // The index is still valid even though the project's shape moved under it
  // (a new README, a renamed asset, a build artifact). Re-snapshot so the next
  // call takes the fast path again — without this, one stray file would leave
  // every later query paying the full walk until the next real reindex.
  if (meta) {
    saveMeta(root, {
      ...meta,
      watched: await resolveWatched(root, ignore),
    });
  }
  return true;
}
