#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { VERSION } from "./index.js";
import { createEngine } from "./core.js";
import { analyzeDeadCode } from "./deadcode.js";
import { sensDir } from "./paths.js";
import { composeRules } from "./rules.js";
import { loadConfig, activeRules, ruleModules } from "./config.js";
import { readUsage, formatUsage, logUsage } from "./usage.js";
import { supportedLanguages } from "./indexer/languages/parser.js";
import { SKILL_MD, SKILL_NAME } from "./skill.js";
import * as ui from "./cli/ui.js";
import {
  renderMap,
  renderSymbols,
  renderWhoUses,
  renderDeadCode,
  renderExplain,
  renderPath,
  renderFileDependencies,
} from "./cli/render.js";
import * as suggest from "./cli/suggest.js";
import type { Block } from "./cli/suggest.js";

const root = process.cwd();
const program = new Command();

program
  .name("sens")
  .description(
    "A project index for Claude Code — query your codebase instead of reading it all.",
  )
  .option("--verbose", "show full error stack traces on failure")
  .version(VERSION);

/**
 * Build (or reuse) the engine with a live spinner. When `announce` is set the
 * spinner resolves into a persistent "index ready" line (for `map`/`index`);
 * otherwise it clears silently so a quick lookup stays clean.
 */
async function getEngine(announce = false): ReturnType<typeof createEngine> {
  const sp = ui.spinner("Indexando proyecto…");
  const start = Date.now();
  let res: Awaited<ReturnType<typeof createEngine>>;
  try {
    res = await createEngine(root);
  } catch (err) {
    sp.fail("No se pudo indexar el proyecto");
    throw err;
  }
  if (announce) {
    const ms = Date.now() - start;
    const label = res.fromCache ? "Índice en caché" : "Índice construido";
    sp.succeed(
      `${label}  ${ui.c.meta(`${ui.sym.branch} ${res.index.files.length} archivos · ${res.index.symbols.length} símbolos · ${ms}ms`)}`,
    );
  } else {
    sp.stop();
  }
  return res;
}

/** Render a query body plus optional dynamic suggestions, padded with blanks. */
function show(body: string, block?: Block): void {
  ui.blank();
  ui.print(body);
  if (block) ui.nextSteps(block.steps, block.title);
  ui.blank();
}

program
  .command("index")
  .description("Build or update the project index")
  .option("-f, --force", "rebuild even if the cache looks fresh")
  .action(async (opts: { force?: boolean }) => {
    ui.header("index");
    const sp = ui.spinner(opts.force ? "Reconstruyendo el índice…" : "Indexando proyecto…");
    const start = Date.now();
    let built: Awaited<ReturnType<typeof createEngine>>;
    try {
      built = await createEngine(root, { force: opts.force });
    } catch (err) {
      sp.fail("No se pudo indexar el proyecto");
      throw err;
    }
    const ms = Date.now() - start;
    const { index, fromCache } = built;
    sp.succeed(
      `${fromCache ? "El índice ya estaba al día" : "Índice reconstruido"}  ${ui.c.meta(`${ui.sym.branch} ${index.files.length} archivos · ${index.symbols.length} símbolos · ${ms}ms`)}`,
    );
    if (index.files.length === 0) {
      ui.warn("No se encontraron archivos para indexar.");
      ui.detail(`Sens indexa: ${supportedLanguages()}. Si este proyecto usa otro lenguaje, aún no está soportado.`);
    }
  });

program
  .command("map")
  .argument("[subdir]", "limit to a subdirectory")
  .description("Print a compact map of the project")
  .action(async (subdir?: string) => {
    ui.header(subdir ? `map ${subdir}` : "map");
    const { engine } = await getEngine(true);
    logUsage(root, "project_map", { subdir });
    const entries = engine.map(subdir);
    show(renderMap(entries));

    const dirs = new Set(
      entries.map((e) => (e.file.includes("/") ? e.file.slice(0, e.file.lastIndexOf("/")) : ".")),
    ).size;
    const symbols = entries.reduce((n, e) => n + e.exported.length + e.internalCount, 0);
    ui.box(
      [
        `${ui.c.text(String(entries.length))} archivos ${ui.c.meta("·")} ${ui.c.text(String(symbols))} símbolos ${ui.c.meta("·")} ${ui.c.text(String(dirs))} carpetas`,
        `${ui.c.meta(ui.sym.arrow)} ${ui.c.brand("sens find <name>")}  ${ui.c.meta("localizar un símbolo")}`,
        `${ui.c.meta(ui.sym.arrow)} ${ui.c.brand("sens who <name>")}   ${ui.c.meta("ver quién lo usa")}`,
      ],
      { title: "Resumen" },
    );
  });

program
  .command("find")
  .argument("<name>", "symbol name")
  .description("Find where a symbol is defined")
  .action(async (name: string) => {
    ui.header(`find ${name}`);
    const { engine } = await getEngine();
    logUsage(root, "find_symbol", { name });
    const syms = engine.findSymbol(name);
    show(renderSymbols(syms, `Sin coincidencias para “${name}”.`), suggest.find(name, syms.length));
  });

program
  .command("who")
  .argument("<name>", "symbol name")
  .description("List where a symbol is used")
  .option("--full", "list every call site instead of a partial summary for heavily-used symbols")
  .action(async (name: string, opts: { full?: boolean }) => {
    ui.header(`who ${name}`);
    const { engine } = await getEngine();
    logUsage(root, "who_uses", { name, full: opts.full });
    const results = engine.whoUses(name);
    show(renderWhoUses(results, { full: opts.full }), suggest.who(name, results.length));
  });

program
  .command("explain")
  .argument("<name>", "symbol name")
  .description("Show a symbol's callers and callees (call graph neighborhood)")
  .action(async (name: string) => {
    ui.header(`explain ${name}`);
    const { engine } = await getEngine();
    logUsage(root, "explain_symbol", { name });
    const results = engine.explain(name);
    show(renderExplain(results), suggest.explain(name, results.length));
  });

program
  .command("path")
  .argument("<from>", "source symbol name")
  .argument("<to>", "target symbol name")
  .description("Shortest chain of calls/references connecting two symbols")
  .action(async (from: string, to: string) => {
    ui.header(`path ${from} → ${to}`);
    const { engine } = await getEngine();
    logUsage(root, "symbol_path", { from, to });
    const p = engine.path(from, to);
    show(renderPath(p, from, to), suggest.path(from, to, !!(p && p.length)));
  });

program
  .command("outline")
  .argument("<file>", "file path")
  .description("Print a file's signatures, without its bodies")
  .action(async (file: string) => {
    ui.header(`outline ${file}`);
    const { engine } = await getEngine();
    logUsage(root, "file_outline", { file });
    const syms = engine.fileOutline(file);
    show(renderSymbols(syms, `Sin símbolos en “${file}”.`), suggest.outline(file, syms.length));
  });

program
  .command("exists")
  .argument("<keywords...>", "keywords describing the functionality")
  .description("Check whether something matching these keywords already exists")
  .action(async (keywords: string[]) => {
    const query = keywords.join(" ");
    ui.header(`exists ${query}`);
    const { engine } = await getEngine();
    logUsage(root, "already_exists", { query });
    const syms = engine.alreadyExists(query);
    show(
      renderSymbols(syms, `Nada coincide con “${query}” — parece nuevo.`),
      suggest.exists(query, syms.length, syms[0]?.name),
    );
  });

program
  .command("dead-code")
  .argument("[subdir]", "limit to a subdirectory")
  .description("List unused symbols/exports (candidates)")
  .action(async (subdir?: string) => {
    ui.header(subdir ? `dead-code ${subdir}` : "dead-code");
    const { engine } = await getEngine();
    logUsage(root, "dead_code", { subdir });
    const report = await analyzeDeadCode(root, engine, subdir);
    const top = report.candidates[0]?.symbol.name;
    show(renderDeadCode(report), suggest.deadCode(report.candidates.length + report.files.length, top));
  });

program
  .command("deps")
  .argument("<file>", "file path")
  .description("List a file's imports and importers (import graph)")
  .action(async (file: string) => {
    ui.header(`deps ${file}`);
    const { engine } = await getEngine();
    logUsage(root, "file_dependencies", { file });
    show(renderFileDependencies(engine.fileDependencies(file)), suggest.deps(file));
  });

program
  .command("report")
  .description("Generate a static, self-contained HTML report")
  .option("-o, --out <path>", "output file path")
  .action(async (opts: { out?: string }) => {
    ui.header("report");
    const sp = ui.spinner("Generando el reporte HTML…");
    let out: string;
    try {
      const { engine, index } = await createEngine(root);
      const { renderReport } = await import("./report/html.js");
      out = opts.out ?? path.join(sensDir(root), "report.html");
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, renderReport(index, engine), "utf8");
    } catch (err) {
      sp.fail("No se pudo generar el reporte");
      throw err;
    }
    sp.succeed("Reporte generado");
    ui.detail(out);
  });

program
  .command("dashboard")
  .description("Start the local web dashboard (graph, dead code, Claude Code setup)")
  .option("-p, --port <port>", "port to listen on", "4319")
  .option("-r, --root <dir>", "project directory to inspect", ".")
  .option("--no-open", "do not open the browser automatically")
  .option("--host", "expose on your local network (0.0.0.0), behind an access token")
  .option("--tunnel", "also create a public URL via cloudflared or ngrok (if installed)")
  .action(async (opts: { port: string; root: string; open: boolean; host?: boolean; tunnel?: boolean }) => {
    const { startDashboard } = await import("./dashboard/server.js");
    await startDashboard(path.resolve(opts.root), {
      port: Number(opts.port),
      open: opts.open,
      host: opts.host,
      tunnel: opts.tunnel,
    });
  });

program
  .command("rules")
  .description("Print the working rules currently active for this project (reuse, minimal, no orphans, …)")
  .option("-w, --write [file]", "write the rules to a file instead of printing (default: SENS_RULES.md)")
  .option("-l, --list", "list every rule module and whether it is on or off")
  .action((opts: { write?: string | boolean; list?: boolean }) => {
    const config = loadConfig(root);
    if (opts.list) {
      ui.header("rules --list");
      ui.blank();
      for (const { module, active } of ruleModules(config)) {
        const bullet = active ? ui.c.brand(ui.sym.file) : ui.c.meta(ui.sym.empty);
        const id = module.id.padEnd(18);
        const tag = active ? ui.c.brand("on ") : ui.c.meta("off");
        ui.print(`${ui.INDENT}${bullet} ${(active ? ui.c.text : ui.c.meta)(id)} ${tag}  ${ui.c.meta(module.title)}`);
      }
      ui.blank();
      return;
    }
    const rules = composeRules(activeRules(config));
    if (opts.write) {
      const out = typeof opts.write === "string" ? opts.write : "SENS_RULES.md";
      writeFileSync(out, rules + "\n", "utf8");
      ui.header("rules");
      ui.success("Reglas escritas");
      ui.detail(`${out} — referéncialas desde tu CLAUDE.md / AGENTS.md`);
    } else {
      ui.print(rules);
    }
  });

program
  .command("skill")
  .description("Print the sens skill (SKILL.md), or install it into .claude/skills/")
  .option("-w, --write [dir]", "write the skill into a project's .claude/skills/ (default: ./.claude/skills)")
  .action((opts: { write?: string | boolean }) => {
    if (opts.write) {
      const base = typeof opts.write === "string" ? opts.write : path.join(".claude", "skills");
      const dir = path.join(base, SKILL_NAME);
      mkdirSync(dir, { recursive: true });
      const out = path.join(dir, "SKILL.md");
      writeFileSync(out, SKILL_MD, "utf8");
      ui.header("skill");
      ui.success("Skill instalada");
      ui.detail(`${out} — Claude Code la carga bajo demanda`);
    } else {
      ui.print(SKILL_MD);
    }
  });

program
  .command("usage")
  .description("Show which Sens tools the model has actually called (from the MCP usage log)")
  .action(() => {
    ui.header("usage");
    ui.blank();
    ui.print(formatUsage(readUsage(root)));
    ui.blank();
  });

program
  .command("init")
  .description("Set up sens here for an agent: index + rules, plus the skill/hooks on Claude Code")
  .option("--agent <name>", "claude | codex | copilot | cursor | all", "claude")
  .action(async (opts: { agent: string }) => {
    ui.header(`init ${opts.agent}`);
    const { initProject } = await import("./init.js");
    const sp = ui.spinner("Indexando y preparando el agente…");
    let results: Awaited<ReturnType<typeof initProject>>;
    try {
      results = await initProject(root, { agent: opts.agent });
    } catch (err) {
      sp.fail("No se pudo inicializar sens");
      throw err;
    }
    sp.succeed(`Índice construido  ${ui.c.meta(`${ui.sym.branch} ${results[0].indexedFiles} archivo(s)`)}`);
    for (const r of results) {
      if (r.agent === "claude") {
        ui.success(`Skill instalada  ${ui.c.meta(`${ui.sym.branch} ${r.skillPath ?? ""} [claude]`)}`);
        if (r.hookWired === "skipped") {
          ui.warn(`No se pudo leer ${r.settingsPath ?? ""} — añade los hooks a mano`);
        } else {
          const verb = r.hookWired === "added" ? "conectados en" : "ya estaban en";
          ui.success(`Hooks ${verb}  ${ui.c.meta(`${ui.sym.branch} ${r.settingsPath ?? ""} [claude]`)}`);
        }
      } else {
        ui.success(`Reglas ${r.instructionsWritten}  ${ui.c.meta(`${ui.sym.branch} ${r.instructionsPath ?? ""} [${r.agent}]`)}`);
      }
    }
    ui.blank();
    ui.detail("sens debe estar en el PATH (npm i -g sens-mcp) para que los agentes puedan invocarlo.");
  });

program
  .command("mcp")
  .description("Start the MCP server (stdio) for Claude Code")
  .action(async () => {
    const { startMcpServer } = await import("./mcp/server.js");
    await startMcpServer(root);
  });

program
  .command("hook")
  .description(
    "PreToolUse hook: nudge the model toward sens tools before it reads/greps (reads hook JSON from stdin)",
  )
  .action(async () => {
    const { runHook } = await import("./hook.js");
    await runHook();
  });

program.parseAsync().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  ui.error(message);
  if (program.opts().verbose && err instanceof Error && err.stack) {
    console.error(ui.c.meta(err.stack));
  } else {
    ui.detail("vuelve a ejecutar con --verbose para ver el stack completo");
  }
  process.exit(1);
});
