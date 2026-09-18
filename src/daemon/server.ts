// The resident query process: holds the parsed index and its engine in memory
// and answers queries over a local socket.
//
// It is a cache, not an authority. Every request still goes through `runQuery`,
// so the freshness check runs exactly as it would in a one-shot CLI call — a
// daemon can serve a fast answer, never a stale one.

import { createServer, type Socket, type Server } from "node:net";
import { unlinkSync } from "node:fs";
import { runQuery, type QueryArgs, type QueryName } from "../queries.js";
import { runHookPayload } from "../hook.js";
import { createEngine } from "../core.js";
import {
  socketPath,
  SHUTDOWN,
  HOOK,
  IDLE_TIMEOUT_MS,
  type DaemonRequest,
  type DaemonResponse,
} from "./protocol.js";

/** Remove a socket file left behind by a daemon that died without cleaning up. */
function clearStaleSocket(addr: string): void {
  if (process.platform === "win32") return; // named pipes vanish with the process
  try {
    unlinkSync(addr);
  } catch {
    // Nothing there, which is the normal case.
  }
}

/**
 * Serve queries for `root` until idle for IDLE_TIMEOUT_MS.
 *
 * Resolves once the socket is listening; the returned `close` is for tests and
 * for `sens daemon --stop` running in-process.
 */
export async function startDaemon(
  root: string,
): Promise<{ address: string; close: () => Promise<void> }> {
  const address = socketPath(root);
  clearStaleSocket(address);

  let idleTimer: NodeJS.Timeout | undefined;
  let server: Server;

  const shutdown = (): Promise<void> =>
    new Promise((resolve) => {
      if (idleTimer) clearTimeout(idleTimer);
      server.close(() => {
        clearStaleSocket(address);
        resolve();
      });
      // A client holding an idle connection must not keep us alive.
      server.unref();
    });

  const touch = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      void shutdown().then(() => process.exit(0));
    }, IDLE_TIMEOUT_MS);
    idleTimer.unref?.();
  };

  const handle = async (line: string, socket: Socket): Promise<void> => {
    let id = 0;
    try {
      const req = JSON.parse(line) as DaemonRequest;
      id = req.id;
      if (req.query === SHUTDOWN) {
        socket.write(JSON.stringify({ id, ok: true, text: "" }) + "\n");
        void shutdown().then(() => process.exit(0));
        return;
      }
      if (req.query === HOOK) {
        // The slim hook client ships us the raw payload; we run the same logic
        // it would have run, with the engine already warm.
        const text = await runHookPayload(root, String(req.args.raw ?? ""));
        socket.write(JSON.stringify({ id, ok: true, text }) + "\n");
        return;
      }
      // `root` is fixed at startup and never taken from the request: a daemon
      // answers for its own project only, so a client cannot point it elsewhere.
      const text = await runQuery(
        root,
        req.query as QueryName,
        req.args as QueryArgs[QueryName],
      );
      const res: DaemonResponse = { id, ok: true, text };
      socket.write(JSON.stringify(res) + "\n");
    } catch (err) {
      const res: DaemonResponse = {
        id,
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      };
      socket.write(JSON.stringify(res) + "\n");
    }
  };

  server = createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      touch();
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) void handle(line, socket);
      }
    });
    // A client that dies mid-request must not take the daemon with it.
    socket.on("error", () => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(address, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  // Warm the engine now, so the first real request is already fast.
  try {
    await createEngine(root);
  } catch {
    // A project that cannot be indexed yet still gets a daemon; the error
    // surfaces on the request that asks for something.
  }

  touch();
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      void shutdown().then(() => process.exit(0));
    });
  }

  return { address, close: shutdown };
}
