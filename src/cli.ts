#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { VERSION } from "./index.js";
import { createEngine } from "./core.js";
import { startMcpServer } from "./mcp/server.js";
import { startDashboard } from "./dashboard/server.js";
import { renderReport } from "./report/html.js";
import { sensDir } from "./paths.js";
import { supportedLanguages } from "./indexer/languages/parser.js";
import {
  formatMap,
  formatSymbols,
  formatWhoUses,
  formatDeadCode,
  formatFileDependencies,
} from "./format.js";

const root = process.cwd();
const program = new Command();

program
  .name("sens")
  .description(
    "A project index for Claude Code — query your codebase instead of reading it all.",
  )
  .version(VERSION);

program
  .command("index")
  .description("Build or update the project index")
  .option("-f, --force", "rebuild even if the cache looks fresh")
  .action(async (opts: { force?: boolean }) => {
    const start = Date.now();
    const { index, fromCache } = await createEngine(root, { force: opts.force });
    const ms = Date.now() - start;
    console.log(
      `${pc.green("✓")} ${fromCache ? "cache is fresh" : "index rebuilt"} — ` +
        `${index.files.length} files, ${index.symbols.length} symbols ${pc.dim(`(${ms}ms)`)}`,
    );
    if (index.files.length === 0) {
      console.log(
        pc.yellow(
          `⚠ No source files found to index. Sens indexes: ${supportedLanguages()}.\n` +
            "  If this project uses another language, it isn't supported yet.",
        ),
      );
    }
  });

program
  .command("map")
  .argument("[subdir]", "limit to a subdirectory")
  .description("Print a compact map of the project")
  .action(async (subdir?: string) => {
    const { engine } = await createEngine(root);
    console.log(formatMap(engine.map(subdir)));
  });

program
  .command("find")
  .argument("<name>", "symbol name")
  .description("Find where a symbol is defined")
  .action(async (name: string) => {
    const { engine } = await createEngine(root);
    console.log(formatSymbols(engine.findSymbol(name)));
  });

program
  .command("who")
  .argument("<name>", "symbol name")
  .description("List where a symbol is used")
  .option("--full", "list every call site instead of a partial summary for heavily-used symbols")
  .action(async (name: string, opts: { full?: boolean }) => {
    const { engine } = await createEngine(root);
    console.log(formatWhoUses(engine.whoUses(name), { full: opts.full }));
  });

program
  .command("outline")
  .argument("<file>", "file path")
  .description("Print a file's signatures, without its bodies")
  .action(async (file: string) => {
    const { engine } = await createEngine(root);
    console.log(formatSymbols(engine.fileOutline(file)));
  });

program
  .command("exists")
  .argument("<keywords...>", "keywords describing the functionality")
  .description("Check whether something matching these keywords already exists")
  .action(async (keywords: string[]) => {
    const { engine } = await createEngine(root);
    console.log(formatSymbols(engine.alreadyExists(keywords.join(" "))));
  });

program
  .command("dead-code")
  .argument("[subdir]", "limit to a subdirectory")
  .description("List unused symbols/exports (candidates)")
  .action(async (subdir?: string) => {
    const { engine } = await createEngine(root);
    const dead = engine.deadCode(subdir);
    const out = formatDeadCode(dead);
    console.log(dead.length ? pc.yellow(out) : pc.green(out));
  });

program
  .command("deps")
  .argument("<file>", "file path")
  .description("List a file's imports and importers (import graph)")
  .action(async (file: string) => {
    const { engine } = await createEngine(root);
    console.log(formatFileDependencies(engine.fileDependencies(file)));
  });

program
  .command("report")
  .description("Generate a static, self-contained HTML report")
  .option("-o, --out <path>", "output file path")
  .action(async (opts: { out?: string }) => {
    const { engine, index } = await createEngine(root);
    const out = opts.out ?? path.join(sensDir(root), "report.html");
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, renderReport(index, engine), "utf8");
    console.log(`${pc.green("✓")} report written to ${pc.cyan(out)}`);
  });

program
  .command("dashboard")
  .description("Start the local web dashboard (graph, dead code, Claude Code setup)")
  .option("-p, --port <port>", "port to listen on", "4319")
  .option("-r, --root <dir>", "project directory to inspect", ".")
  .option("--no-open", "do not open the browser automatically")
  .action(async (opts: { port: string; root: string; open: boolean }) => {
    await startDashboard(path.resolve(opts.root), { port: Number(opts.port), open: opts.open });
  });

program
  .command("mcp")
  .description("Start the MCP server (stdio) for Claude Code")
  .action(async () => {
    await startMcpServer(root);
  });

program.parseAsync();
