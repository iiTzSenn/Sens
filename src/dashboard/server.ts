import { createServer } from "node:http";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createEngine } from "../core.js";
import type { ProjectIndex } from "../types.js";
import type { QueryEngine } from "../query/engine.js";
import { renderDashboardPage } from "./page.js";

function buildData(root: string, index: ProjectIndex, engine: QueryEngine) {
  const dead = engine.deadCode();
  const deadByFile = new Map<string, number>();
  for (const d of dead) deadByFile.set(d.file, (deadByFile.get(d.file) ?? 0) + 1);

  const symByFile = new Map<string, number>();
  const expByFile = new Map<string, number>();
  for (const s of index.symbols) {
    symByFile.set(s.file, (symByFile.get(s.file) ?? 0) + 1);
    if (s.exported) expByFile.set(s.file, (expByFile.get(s.file) ?? 0) + 1);
  }

  const nodes = index.files.map((f) => ({
    id: f.path,
    label: f.path.split("/").pop() ?? f.path,
    symbols: symByFile.get(f.path) ?? 0,
    exported: expByFile.get(f.path) ?? 0,
    dead: deadByFile.get(f.path) ?? 0,
  }));

  const fileSet = new Set(index.files.map((f) => f.path));
  const seen = new Set<string>();
  const links: { source: string; target: string }[] = [];
  for (const imp of index.imports) {
    if (!fileSet.has(imp.to) || imp.from === imp.to) continue;
    const key = `${imp.from}->${imp.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: imp.from, target: imp.to });
  }

  return {
    project: path.basename(root) || "project",
    connected: isConnected(root),
    stats: {
      files: index.files.length,
      symbols: index.symbols.length,
      exported: index.symbols.filter((s) => s.exported).length,
      dead: dead.length,
    },
    graph: { nodes, links },
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
