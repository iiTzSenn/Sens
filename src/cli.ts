#!/usr/bin/env node
import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { VERSION } from "./index.js";
import { createEngine, refreshIndex } from "./core.js";
import { analyzeDeadCode } from "./deadcode.js";
import { composeRules } from "./rules.js";
import { loadConfig, activeRules, ruleModules } from "./config.js";
import { supportedLanguages } from "./indexer/languages/parser.js";
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
import { nativeQuery } from "./native-query.js";
import type { QueryArgs, QueryName } from "./queries.js";
import type { QueryEngine } from "./query/engine.js";
import type { ProjectIndex } from "./types.js";

const root = process.cwd();
const program = new Command();

program
  .name("sens")
  .description(
    "A project index for Claude Code — query your codebase instead of reading it all.",
  )
  .option("--verbose", "show full error stack traces on failure")
  .version(VERSION);

async function ask<K extends QueryName, T>(
  name: K,
  args: QueryArgs[K],
  fromEngine: (engine: QueryEngine) => T | Promise<T>,
): Promise<T> {
  const native = nativeQuery(root, name, args);
  if (native !== null) return native as T;
  const { engine } = await getEngine();
  return fromEngine(engine);
}

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

function show(body: string, block?: Block): void {
  ui.blank();
  ui.print(body);
  if (block) ui.nextSteps(block.steps, block.title);
  ui.blank();
}

interface Summary {
  files: number;
  symbols: number;
  said: string;
}

async function updateOnly(touched: string[]): Promise<Summary> {
  const { index, incremental } = await refreshIndex(root, touched);
  return {
    files: index.files.length,
    symbols: index.symbols.length,
    said: incremental ? "Índice actualizado" : "Índice reconstruido",
  };
}

async function indexAll(force?: boolean): Promise<Summary> {
  const { index, fromCache } = await createEngine(root, { force });
  return {
    files: index.files.length,
    symbols: index.symbols.length,
    said: fromCache ? "El índice ya estaba al día" : "Índice reconstruido",
  };
}


program
program
  .command("index")
  .description("Build or update the project index")
  .option("-f, --force", "rebuild even if the cache looks fresh")
  .option("--only <paths...>", "update just these files")
  .action(async (opts: { force?: boolean; only?: string[] }) => {
    ui.header("index");
    const touched = opts.only ?? [];
    const sp = ui.spinner(
      touched.length > 0
        ? `Actualizando ${touched.length === 1 ? "1 archivo" : `${touched.length} archivos`}…`
        : opts.force
          ? "Reconstruyendo el índice…"
          : "Indexando proyecto…",
    );
    const start = Date.now();
    let done: Summary;
    try {
      done = touched.length > 0 ? await updateOnly(touched) : await indexAll(opts.force);
    } catch (err) {
      sp.fail("No se pudo indexar el proyecto");
      throw err;
    }
    const ms = Date.now() - start;
    sp.succeed(
      `${done.said}  ${ui.c.meta(`${ui.sym.branch} ${done.files} archivos · ${done.symbols} símbolos · ${ms}ms`)}`,
    );
    if (done.files === 0) {
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
    const syms = await ask("find_symbol", { name }, (e) => e.findSymbol(name));
    show(renderSymbols(syms, `Sin coincidencias para “${name}”.`), suggest.find(name, syms.length));
  });

program
  .command("who")
  .argument("<name>", "symbol name")
  .description("List where a symbol is used")
  .option("--full", "list every call site instead of a partial summary for heavily-used symbols")
  .action(async (name: string, opts: { full?: boolean }) => {
    ui.header(`who ${name}`);
    const results = await ask("who_uses", { name, full: opts.full }, (e) => e.whoUses(name));
    show(renderWhoUses(results, { full: opts.full }), suggest.who(name, results.length));
  });

program
  .command("explain")
  .argument("<name>", "symbol name")
  .description("Show a symbol's callers and callees (call graph neighborhood)")
  .action(async (name: string) => {
    ui.header(`explain ${name}`);
    const results = await ask("explain_symbol", { name }, (e) => e.explain(name));
    show(renderExplain(results), suggest.explain(name, results.length));
  });

program
  .command("path")
  .argument("<from>", "source symbol name")
  .argument("<to>", "target symbol name")
  .description("Shortest chain of calls/references connecting two symbols")
  .action(async (from: string, to: string) => {
    ui.header(`path ${from} → ${to}`);
    const p = await ask("symbol_path", { from, to }, (e) => e.path(from, to));
    show(renderPath(p, from, to), suggest.path(from, to, !!(p && p.length)));
  });

program
  .command("outline")
  .argument("<file>", "file path")
  .description("Print a file's signatures, without its bodies")
  .action(async (file: string) => {
    ui.header(`outline ${file}`);
    const syms = await ask("file_outline", { file }, (e) => e.fileOutline(file));
    show(renderSymbols(syms, `Sin símbolos en “${file}”.`), suggest.outline(file, syms.length));
  });

program
  .command("exists")
  .argument("<keywords...>", "keywords describing the functionality")
  .description("Check whether something matching these keywords already exists")
  .action(async (keywords: string[]) => {
    const query = keywords.join(" ");
    ui.header(`exists ${query}`);
    const syms = await ask("already_exists", { query }, (e) => e.alreadyExists(query));
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
    const report = await ask("dead_code", { subdir }, (e) => analyzeDeadCode(root, e, subdir));
    const top = report.candidates[0]?.symbol.name;
    show(renderDeadCode(report), suggest.deadCode(report.candidates.length + report.files.length, top));
  });

program
  .command("deps")
  .argument("<file>", "file path")
  .description("List a file's imports and importers (import graph)")
  .action(async (file: string) => {
    ui.header(`deps ${file}`);
    const deps = await ask("file_dependencies", { file }, (e) => e.fileDependencies(file));
    show(renderFileDependencies(deps), suggest.deps(file));
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

    const { runHookClient } = await import("./hook-client.js");
    await runHookClient();
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
