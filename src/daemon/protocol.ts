// Wire format and addressing for the query daemon.
//
// The daemon exists because the PreToolUse hook runs as a *new process* on
// every Read/Grep the model makes: it pays node's startup, the bundle import,
// re-reading a multi-megabyte index and rebuilding the engine's lookup maps,
// just to answer one question. A resident process keeps all of that warm and
// answers over a local socket.
//
// One daemon per (project root, Sens version). Putting the version in the
// address means an upgraded Sens never talks to a daemon running the old code
// — the stale one simply idles out.

import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { VERSION } from "../index.js";

/** Queries the daemon can answer, mirroring `QueryName` in queries.ts. */
export interface DaemonRequest {
  id: number;
  query: string;
  args: Record<string, unknown>;
}

export interface DaemonResponse {
  id: number;
  ok: boolean;
  /** Formatted answer when ok, error message otherwise. */
  text: string;
}

/** Reserved query name asking the daemon to exit. Not a real query. */
export const SHUTDOWN = "__shutdown__";

/** Reserved name asking the daemon to run a whole PreToolUse hook payload. */
export const HOOK = "__hook__";

/** Shut down after this long with no requests, so no process is left behind. */
export const IDLE_TIMEOUT_MS = Number(process.env.SENS_DAEMON_IDLE_MS) || 10 * 60_000;

/** How long a client waits for an answer before giving up and doing it itself. */
export const REQUEST_TIMEOUT_MS = 5_000;

/** Don't try to respawn a daemon that just failed to come up. */
export const SPAWN_COOLDOWN_MS = 10_000;

const key = (root: string): string =>
  createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16);

/**
 * Address of the daemon for `root`: a Windows named pipe (which the OS reclaims
 * when the process dies) or a socket file under the temp dir — never inside the
 * project, where it would be one more thing for the indexer to notice.
 */
export function socketPath(root: string): string {
  const name = `sens-${VERSION}-${key(root)}`;
  if (process.platform !== "win32") return path.join(tmpdir(), `${name}.sock`);
  // Named pipes live under the UNC-style prefix that `path.sep` spells on
  // Windows; composing it from `sep` keeps the backslashes out of the source,
  // where they are easy to miscount and impossible to see.
  const s = path.sep;
  return `${s}${s}.${s}pipe${s}${name}`;
}

/** Marker used to rate-limit spawn attempts (see SPAWN_COOLDOWN_MS). */
export function spawnMarkerPath(root: string): string {
  return path.join(tmpdir(), `sens-${VERSION}-${key(root)}.spawn`);
}

/** True when the user asked for no background process. */
export const daemonDisabled = (): boolean =>
  process.env.SENS_NO_DAEMON === "1" || process.env.SENS_NO_DAEMON === "true";
