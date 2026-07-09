#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { VERSION } from "./index.js";
import { createEngine } from "./core.js";
import { sensDir } from "./paths.js";
import { composeRules } from "./rules.js";
import { loadConfig, activeRules, ruleModules } from "./config.js";
import { readUsage, formatUsage } from "./usage.js";
import { supportedLanguages } from "./indexer/languages/parser.js";
import { runQuery } from "./queries.js";
import { SKILL_MD, SKILL_NAME } from "./skill.js";

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
    console.log(await runQuery(root, "project_map", { subdir }));
  });

program
  .command("find")
  .argument("<name>", "symbol name")
  .description("Find where a symbol is defined")
  .action(async (name: string) => {
    console.log(await runQuery(root, "find_symbol", { name }));
  });

program
  .command("who")
  .argument("<name>", "symbol name")
  .description("List where a symbol is used")
  .option("--full", "list every call site instead of a partial summary for heavily-used symbols")
  .action(async (name: string, opts: { full?: boolean }) => {
    console.log(await runQuery(root, "who_uses", { name, full: opts.full }));
  });

program
  .command("explain")
  .argument("<name>", "symbol name")
  .description("Show a symbol's callers and callees (call graph neighborhood)")
  .action(async (name: string) => {
    console.log(await runQuery(root, "explain_symbol", { name }));
  });

program
  .command("path")
  .argument("<from>", "source symbol name")
  .argument("<to>", "target symbol name")
  .description("Shortest chain of calls/references connecting two symbols")
  .action(async (from: string, to: string) => {
    console.log(await runQuery(root, "symbol_path", { from, to }));
  });

program
  .command("outline")
  .argument("<file>", "file path")
  .description("Print a file's signatures, without its bodies")
  .action(async (file: string) => {
    console.log(await runQuery(root, "file_outline", { file }));
  });

program
  .command("exists")
  .argument("<keywords...>", "keywords describing the functionality")
  .description("Check whether something matching these keywords already exists")
  .action(async (keywords: string[]) => {
    console.log(await runQuery(root, "already_exists", { query: keywords.join(" ") }));
  });

program
  .command("dead-code")
  .argument("[subdir]", "limit to a subdirectory")
  .description("List unused symbols/exports (candidates)")
  .action(async (subdir?: string) => {
    const out = await runQuery(root, "dead_code", { subdir });
    console.log(out.startsWith("no dead-code") ? pc.green(out) : pc.yellow(out));
  });

program
  .command("deps")
  .argument("<file>", "file path")
  .description("List a file's imports and importers (import graph)")
  .action(async (file: string) => {
    console.log(await runQuery(root, "file_dependencies", { file }));
  });

program
  .command("report")
  .description("Generate a static, self-contained HTML report")
  .option("-o, --out <path>", "output file path")
  .action(async (opts: { out?: string }) => {
    const { engine, index } = await createEngine(root);
    const { renderReport } = await import("./report/html.js");
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
    const { startDashboard } = await import("./dashboard/server.js");
    await startDashboard(path.resolve(opts.root), { port: Number(opts.port), open: opts.open });
  });

program
  .command("rules")
  .description("Print the working rules currently active for this project (reuse, minimal, no orphans, …)")
  .option("-w, --write [file]", "write the rules to a file instead of printing (default: SENS_RULES.md)")
  .option("-l, --list", "list every rule module and whether it is on or off")
  .action((opts: { write?: string | boolean; list?: boolean }) => {
    const config = loadConfig(root);
    if (opts.list) {
      for (const { module, active } of ruleModules(config)) {
        const tag = active ? pc.green("on ") : pc.dim("off");
        console.log(`  [${tag}] ${module.id}  ${pc.dim(module.title)}`);
      }
      return;
    }
    const rules = composeRules(activeRules(config));
    if (opts.write) {
      const out = typeof opts.write === "string" ? opts.write : "SENS_RULES.md";
      writeFileSync(out, rules + "\n", "utf8");
      console.log(
        `${pc.green("✓")} rules written to ${pc.cyan(out)} ${pc.dim("— reference it from your CLAUDE.md / AGENTS.md")}`,
      );
    } else {
      console.log(rules);
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
      console.log(
        `${pc.green("✓")} skill written to ${pc.cyan(out)} ${pc.dim("— Claude Code loads it on demand")}`,
      );
    } else {
      console.log(SKILL_MD);
    }
  });

program
  .command("usage")
  .description("Show which Sens tools the model has actually called (from the MCP usage log)")
  .action(() => {
    console.log(formatUsage(readUsage(root)));
  });

program
  .command("init")
  .description("Set up sens here for an agent: index + rules, plus the skill/hooks on Claude Code")
  .option("--agent <name>", "claude | codex | copilot | cursor | all", "claude")
  .action(async (opts: { agent: string }) => {
    const { initProject } = await import("./init.js");
    let results;
    try {
      results = await initProject(root, { agent: opts.agent });
    } catch (err) {
      console.error(pc.red(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
      return;
    }
    console.log(`${pc.green("✓")} index built — ${results[0].indexedFiles} file(s)`);
    for (const r of results) {
      if (r.agent === "claude") {
        console.log(`${pc.green("✓")} skill installed — ${pc.cyan(r.skillPath ?? "")} ${pc.dim("[claude]")}`);
        if (r.hookWired === "skipped") {
          console.log(`${pc.yellow("⚠")} could not parse ${pc.cyan(r.settingsPath ?? "")} — add the hooks manually`);
        } else {
          const verb = r.hookWired === "added" ? "wired into" : "already in";
          console.log(`${pc.green("✓")} hooks ${verb} ${pc.cyan(r.settingsPath ?? "")} ${pc.dim("[claude]")}`);
        }
      } else {
        console.log(
          `${pc.green("✓")} rules ${r.instructionsWritten} — ${pc.cyan(r.instructionsPath ?? "")} ${pc.dim(`[${r.agent}]`)}`,
        );
      }
    }
    console.log(pc.dim("\nsens must be on PATH (npm i -g sens-mcp) for agents to run its commands."));
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
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
