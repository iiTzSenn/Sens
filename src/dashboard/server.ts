import { createServer } from "node:http";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createEngine } from "../core.js";
import { loadConfig } from "../config.js";
import { loadIndex, isFresh } from "../store/store.js";
import type { ProjectIndex } from "../types.js";
import type { QueryEngine } from "../query/engine.js";
import { renderDashboardPage } from "./page.js";
import { buildGraph, serializeGraph, isExportFormat } from "./graph-export.js";

function buildData(root: string, index: ProjectIndex, engine: QueryEngine) {
  const dead = engine.deadCode();
  return {
    project: path.basename(root) || "project",
    connected: isConnected(root),
    stats: {
      files: index.files.length,
      symbols: index.symbols.length,
      exported: index.symbols.filter((s) => s.exported).length,
      dead: dead.length,
    },
    graph: buildGraph(index, dead),
    dead: dead.map((s) => ({ file: s.file, line: s.line, kind: s.kind, name: s.name })),
    symbols: index.symbols.map((s) => ({
      name: s.name,
      file: s.file,
      line: s.line,
      signature: s.signature,
      exported: s.exported,
    })),
  };
}

function mcpConfigPath(root: string): string {
  return path.join(root, ".mcp.json");
}

function isConnected(root: string): boolean {
  const p = mcpConfigPath(root);
  if (!existsSync(p)) return false;
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return Boolean(j?.mcpServers?.sens);
  } catch {
    return false;
  }
}

function connect(root: string): void {
  const p = mcpConfigPath(root);
  let json: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(p)) {
    try {
      json = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      json = {};
    }
  }
  json.mcpServers = json.mcpServers ?? {};
  json.mcpServers.sens = { command: "npx", args: ["-y", "sens-mcp", "mcp"] };
  writeFileSync(p, JSON.stringify(json, null, 2) + "\n", "utf8");
}

function openBrowser(url: string): void {
  const win = process.platform === "win32";
  const cmd = win ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = win ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* opening the browser is best-effort */
  }
}

export async function startDashboard(
  root: string,
  opts: { port?: number; open?: boolean } = {},
): Promise<void> {
  const port = opts.port ?? 4319;
  const json = (res: import("node:http").ServerResponse, body: unknown) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    try {
      const url = (req.url ?? "/").split("?")[0];
      if (req.method === "GET" && (url === "/" || url === "/index.html")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderDashboardPage());
      } else if (req.method === "GET" && url === "/api/data") {
        const { engine, index } = await createEngine(root);
        json(res, buildData(root, index, engine));
      } else if (req.method === "GET" && url === "/api/export") {
        const fmt = new URL(req.url ?? "/", "http://localhost").searchParams.get("format") ?? "";
        if (!isExportFormat(fmt)) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `unknown export format: ${fmt}` }));
          return;
        }
        const { engine, index } = await createEngine(root);
        const graph = buildGraph(index, engine.deadCode());
        const out = serializeGraph(fmt, graph, path.basename(root) || "project");
        res.writeHead(200, {
          "content-type": out.mime,
          "content-disposition": `attachment; filename="${out.filename}"`,
        });
        res.end(out.body);
      } else if (req.method === "GET" && url === "/api/freshness") {
        const config = loadConfig(root);
        const cached = loadIndex(root);
        const fresh = cached ? await isFresh(root, cached, config.ignore) : false;
        json(res, { fresh });
      } else if (req.method === "POST" && url === "/api/reindex") {
        const { engine, index } = await createEngine(root, { force: true });
        json(res, buildData(root, index, engine));
      } else if (req.method === "POST" && url === "/api/connect") {
        connect(root);
        json(res, { connected: true });
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  const urlStr = `http://localhost:${port}`;
  console.log(`Sens dashboard running at ${urlStr}`);
  console.log("Press Ctrl+C to stop.");
  if (opts.open) openBrowser(urlStr);
}
