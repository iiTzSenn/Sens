import { createServer } from "node:http";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createEngine } from "../core.js";
import {
  loadConfig,
  ruleModules,
  setRuleState,
  addCustomRule,
  removeCustomRule,
  saveRules,
} from "../config.js";
import { loadIndex, isFresh } from "../store/store.js";
import type { ProjectIndex } from "../types.js";
import type { QueryEngine } from "../query/engine.js";
import { renderDashboardPage } from "./page.js";
import { buildGraph, serializeGraph, isExportFormat } from "./graph-export.js";
import * as ui from "../cli/ui.js";
import qrcode from "qrcode-terminal";
import { lanIps, makeToken, readCookie, terminalLink } from "./expose.js";
import { startTunnel, type Tunnel } from "./tunnel.js";

/** Official install pages, linked when no tunnel tool is found. */
const TUNNEL_DOCS: Record<string, string> = {
  cloudflared:
    "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
  ngrok: "https://ngrok.com/download",
};

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
      kind: s.kind,
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

/** The rule modules with their resolved on/off state, for the dashboard's rules panel. */
function rulesPayload(root: string) {
  const config = loadConfig(root);
  const customIds = new Set(config.rules.custom.map((m) => m.id));
  return {
    rules: ruleModules(config).map(({ module, active }) => ({
      id: module.id,
      title: module.title,
      body: module.body,
      active,
      custom: customIds.has(module.id),
    })),
  };
}

/** Read and JSON-parse a request body; returns {} on any failure. */
function readBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
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
  opts: { port?: number; open?: boolean; host?: boolean; tunnel?: boolean } = {},
): Promise<void> {
  const port = opts.port ?? 4319;
  // Exposure is opt-in: the dashboard writes files, so by default it binds to
  // localhost only. `--host`/`--tunnel` bind to every interface behind a token.
  const exposed = Boolean(opts.host || opts.tunnel);
  // Only --host opens the LAN; a tunnel reaches us over localhost, so it stays 127.0.0.1.
  const bindHost = opts.host ? "0.0.0.0" : "127.0.0.1";
  const token = exposed ? makeToken() : null;
  const json = (res: import("node:http").ServerResponse, body: unknown) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    try {
      const url = (req.url ?? "/").split("?")[0];
      // Token gate (only when exposed): accept a `?token=` on first load, then a cookie.
      if (token) {
        const q = new URL(req.url ?? "/", "http://x").searchParams.get("token");
        if (readCookie(req.headers.cookie, "sens_token") !== token && q !== token) {
          res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
          res.end("Sens dashboard: missing or invalid access token — open the link shown in the terminal.");
          return;
        }
        if (q === token) res.setHeader("set-cookie", `sens_token=${token}; Path=/; HttpOnly; SameSite=Strict`);
      }
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
      } else if (req.method === "GET" && url === "/api/rules") {
        json(res, rulesPayload(root));
      } else if (req.method === "POST" && url === "/api/rules/toggle") {
        const body = await readBody(req);
        if (typeof body.id === "string") {
          saveRules(root, setRuleState(loadConfig(root), body.id, Boolean(body.active)));
        }
        json(res, rulesPayload(root));
      } else if (req.method === "POST" && url === "/api/rules/custom") {
        const body = await readBody(req);
        if (
          typeof body.id === "string" &&
          typeof body.title === "string" &&
          typeof body.body === "string" &&
          body.id.trim() &&
          body.title.trim() &&
          body.body.trim()
        ) {
          saveRules(
            root,
            addCustomRule(loadConfig(root), {
              id: body.id.trim(),
              title: body.title.trim(),
              body: body.body.trim(),
            }),
          );
        }
        json(res, rulesPayload(root));
      } else if (req.method === "POST" && url === "/api/rules/remove") {
        const body = await readBody(req);
        if (typeof body.id === "string") {
          saveRules(root, removeCustomRule(loadConfig(root), body.id));
        }
        json(res, rulesPayload(root));
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  });

  await new Promise<void>((resolve) => server.listen(port, bindHost, resolve));

  const suffix = token ? `/?token=${token}` : "";
  const localUrl = `http://localhost:${port}${suffix}`;
  const ips = opts.host ? lanIps() : [];

  const url = (label: string, value: string): void =>
    ui.print(`${ui.INDENT}${ui.c.brand(ui.sym.child)} ${label.padEnd(9)}${ui.c.brand(value)}`);

  ui.header("dashboard");
  ui.blank();
  url("Local", localUrl);
  if (opts.host) {
    if (ips.length === 0) ui.detail("Network: no external IPv4 address found");
    for (const ip of ips) url("Network", `http://${ip}:${port}${suffix}`);
  }

  let tunnel: Tunnel | null = null;
  if (opts.tunnel) {
    const sp = ui.spinner("Abriendo túnel público…");
    tunnel = await startTunnel(port);
    if (tunnel) {
      sp.stop();
      url("Public", `${tunnel.url}${suffix}`);
      ui.detail(`vía ${tunnel.provider}`);
    } else {
      sp.stop();
      const how = Object.entries(TUNNEL_DOCS)
        .map(([name, link]) => terminalLink(ui.c.brand(name), link))
        .join(ui.c.meta("  ·  "));
      ui.warn("Túnel no disponible — no se encontró cloudflared ni ngrok");
      ui.detail(`Cómo instalar: ${how}`);
    }
  }

  const shareUrl = tunnel
    ? `${tunnel.url}${suffix}`
    : ips.length > 0
      ? `http://${ips[0]}:${port}${suffix}`
      : null;
  if (shareUrl) {
    ui.section("Escanea para abrir en otro dispositivo");
    ui.blank();
    qrcode.generate(shareUrl, { small: true });
  }
  if (exposed) {
    ui.blank();
    ui.warn("Cualquiera con el enlace del token puede ver Y modificar la config de sens de este proyecto.");
  }
  ui.blank();
  ui.detail("Ctrl+C para detener.");
  ui.blank();

  if (tunnel) {
    process.on("SIGINT", () => {
      tunnel?.stop();
      process.exit(0);
    });
  }
  if (opts.open) openBrowser(localUrl);
}
