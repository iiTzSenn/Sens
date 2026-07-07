#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { VERSION } from "./index.js";

const todo = (name: string, milestone: string) => () =>
  console.log(pc.dim(`${name}: not implemented yet (${milestone})`));

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
  .action(todo("index", "Milestone 1"));

program
  .command("map")
  .description("Print a compact map of the project")
  .action(todo("map", "Milestone 2"));

program
  .command("dead-code")
  .description("List unused symbols/exports (candidates)")
  .action(todo("dead-code", "Milestone 2"));

program
  .command("report")
  .description("Generate a static, self-contained HTML report")
  .action(todo("report", "Milestone 4"));

program
  .command("mcp")
  .description("Start the MCP server (stdio) for Claude Code")
  .action(todo("mcp", "Milestone 3"));

program.parseAsync();
