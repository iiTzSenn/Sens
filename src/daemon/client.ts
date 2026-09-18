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

export function queryViaDaemon<K extends QueryName>(
  root: string,
  query: K,
  args: QueryArgs[K],
): Promise<string | null> {
  return request(root, { id: 1, query, args: args as Record<string, unknown> });
}

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
    socket.on("error", () => done(null));

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

export function hookViaDaemon(root: string, raw: string): Promise<string | null> {
  return request(root, { id: 1, query: HOOK, args: { raw } });
}
function spawnedRecently(root: string): boolean {
  try {
    return Date.now() - statSync(spawnMarkerPath(root)).mtimeMs < SPAWN_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export function ensureDaemon(root: string): void {
  if (daemonDisabled() || spawnedRecently(root)) return;

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

  }
}
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
