import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { VERSION } from "../index.js";

export interface DaemonRequest {
  id: number;
  query: string;
  args: Record<string, unknown>;
}

export interface DaemonResponse {
  id: number;
  ok: boolean;
  text: string;
}

export const SHUTDOWN = "__shutdown__";

export const HOOK = "__hook__";

export const REINDEX = "__reindex__";

export const IDLE_TIMEOUT_MS = Number(process.env.SENS_DAEMON_IDLE_MS) || 10 * 60_000;

export const REQUEST_TIMEOUT_MS = 5_000;

export const REINDEX_TIMEOUT_MS = 120_000;

export const SPAWN_COOLDOWN_MS = 10_000;

const key = (root: string): string =>
  createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16);

export function socketPath(root: string): string {
  const name = `sens-${VERSION}-${key(root)}`;
  if (process.platform !== "win32") return path.join(tmpdir(), `${name}.sock`);

  const s = path.sep;
  return `${s}${s}.${s}pipe${s}${name}`;
}

export function spawnMarkerPath(root: string): string {
  return path.join(tmpdir(), `sens-${VERSION}-${key(root)}.spawn`);
}

export const daemonDisabled = (): boolean =>
  process.env.SENS_NO_DAEMON === "1" || process.env.SENS_NO_DAEMON === "true";
