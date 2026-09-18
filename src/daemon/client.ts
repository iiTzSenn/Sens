// Client side of the query daemon.
//
// The contract is that the daemon is never required: `queryViaDaemon` returns
// null whenever it cannot get an answer quickly — not running, wrong version,
// busy reindexing, socket refused — and the caller just answers in-process as
// it always did. A broken daemon costs latency, never correctness.

import { connect } from "node:net";
import { spawn } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import type { QueryArgs, QueryName } from "../queries.js";
import {
  socketPath,
  spawnMarkerPath,
  daemonDisabled,
  SHUTDOWN,
  HOOK,
  REQUEST_TIMEOUT_MS,
  SPAWN_COOLDOWN_MS,
  type DaemonRequest,
  type DaemonResponse,
} from "./protocol.js";

/**
 * Ask the daemon for `root` to run a query.
 * Resolves to the formatted answer, or null if the daemon could not serve it.
 */
export function queryViaDaemon<K extends QueryName>(
  root: string,
  query: K,
  args: QueryArgs[K],
): Promise<string | null> {
  return request(root, { id: 1, query, args: args as Record<string, unknown> });
}

/** One request/response round trip. Resolves to null on any failure at all. */
function request(root: string, req: DaemonRequest): Promise<string | null> {
  if (daemonDisabled()) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const done = (value: string | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    const socket = connect(socketPath(root));
    socket.setEncoding("utf8");
    socket.setTimeout(REQUEST_TIMEOUT_MS, () => done(null));
    socket.on("error", () => done(null)); // not running, or a stale socket file

    socket.on("connect", () => socket.write(JSON.stringify(req) + "\n"));

    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      try {
        const res = JSON.parse(buffer.slice(0, nl)) as DaemonResponse;
        done(res.ok ? res.text : null);
      } catch {
        done(null);
      }
    });
  });
}

/**
 * Ask the daemon to run the whole PreToolUse hook for `raw`.
 *
 * The daemon runs the same `runHookPayload` the client would, so the decision
 * logic lives in exactly one place; this side only moves bytes. Resolves to the
 * text to print (possibly ""), or null if no daemon could answer.
 */
export function hookViaDaemon(root: string, raw: string): Promise<string | null> {
  return request(root, { id: 1, query: HOOK, args: { raw } });
}

/** True if a spawn was attempted so recently that another would be pointless. */
function spawnedRecently(root: string): boolean {
  try {
    return Date.now() - statSync(spawnMarkerPath(root)).mtimeMs < SPAWN_COOLDOWN_MS;
  } catch {
    return false;
  }
}

/**
 * Start a daemon for `root` in the background, if one is not already coming up.
 *
 * Fire-and-forget: this call never waits for it and never fails. The current
 * query is answered in-process; the daemon is for the *next* one. The marker
 * file stops a project where the daemon cannot start (no permission to bind a
 * socket, say) from spawning a process per query.
 */
export function ensureDaemon(root: string): void {
  if (daemonDisabled() || spawnedRecently(root)) return;
  // Re-invoke whatever entry point is running right now. Resolving a path
  // relative to this module would be wrong in the bundle, where this code ends
  // up in a chunk one directory deeper than `cli.js`.
  const cli = process.argv[1];
  if (!cli) return;
  try {
    writeFileSync(spawnMarkerPath(root), String(Date.now()), "utf8");
    spawn(process.execPath, [cli, "daemon", "--serve"], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } catch {
    // Best effort — the in-process path already answered the user.
  }
}

/** Ask a running daemon to shut down. Resolves to false if none was running. */
export function stopDaemon(root: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath(root));
    socket.on("error", () => resolve(false));
    socket.on("connect", () => {
      socket.write(JSON.stringify({ id: 0, query: SHUTDOWN, args: {} }) + "\n");
      socket.end();
      resolve(true);
    });
  });
}

/** True if a daemon is listening for `root`. */
export function daemonRunning(root: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath(root));
    socket.on("error", () => resolve(false));
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
  });
}
