import { createServer, type Socket, type Server } from "node:net";
import { unlinkSync } from "node:fs";
import { runQuery, type QueryArgs, type QueryName } from "../queries.js";
import { runHookPayload } from "../hook.js";
import { createEngine, refreshIndex } from "../core.js";
import { warmProject } from "../indexer/incremental.js";
import { loadIndex } from "../store/store.js";
import {
  socketPath,
  SHUTDOWN,
  HOOK,
  REINDEX,
  IDLE_TIMEOUT_MS,
  type DaemonRequest,
  type DaemonResponse,
} from "./protocol.js";

function clearStaleSocket(addr: string): void {
  if (process.platform === "win32") return;
  try {
    unlinkSync(addr);
  } catch {
  }
}

export async function startDaemon(
  root: string,
  opts: { warm?: boolean } = {},
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

        const text = await runHookPayload(root, String(req.args.raw ?? ""));
        socket.write(JSON.stringify({ id, ok: true, text }) + "\n");
        return;
      }
      if (req.query === REINDEX) {
        const only = Array.isArray(req.args.only) ? req.args.only.map(String) : [];
        const { index, incremental } = await refreshIndex(root, only, { keepWarm: true });
        const text = JSON.stringify({
          files: index.files.length,
          symbols: index.symbols.length,
          incremental,
        });
        socket.write(JSON.stringify({ id, ok: true, text }) + "\n");
        return;
      }

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

    socket.on("error", () => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(address, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  try {
    await createEngine(root);
    if (opts.warm) {
      const index = loadIndex(root);
      if (index) await warmProject(root, index);
    }
  } catch {

  }

  touch();
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      void shutdown().then(() => process.exit(0));
    });
  }

  return { address, close: shutdown };
}
