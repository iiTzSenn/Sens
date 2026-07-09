import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION } from "../index.js";
import { AGENT_RULES } from "../rules.js";
import { runQuery } from "../queries.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/**
 * Start the Sens MCP server over stdio.
 *
 * Every tool just forwards to `runQuery`, the shared path used by the CLI and the
 * PreToolUse hook too — so the index cache, usage logging and output formatting
 * are identical no matter which transport asked.
 */
export async function startMcpServer(root: string): Promise<void> {
  const server = new McpServer(
    { name: "sens", version: VERSION },
    { instructions: AGENT_RULES },
  );

  server.registerTool(
    "project_map",
    {
      description:
        "Compact map of the project: one line per file with its exported symbols. Use this to orient yourself instead of reading many files.",
      inputSchema: { subdir: z.string().optional() },
    },
    async ({ subdir }: { subdir?: string }) =>
      text(await runQuery(root, "project_map", { subdir })),
  );

  server.registerTool(
    "find_symbol",
    {
      description:
        "Locate where a symbol is defined: returns file:line and its signature. Replaces grep.",
      inputSchema: { name: z.string() },
    },
    async ({ name }: { name: string }) =>
      text(await runQuery(root, "find_symbol", { name })),
  );

  server.registerTool(
    "who_uses",
    {
      description:
        "List every place a symbol is used, so you can edit it safely without grepping. " +
        "For heavily-used symbols this defaults to a partial summary (busiest files) to save tokens — " +
        "pass full:true to get every call site before renaming/editing all usages, so you don't miss any.",
      inputSchema: { name: z.string(), full: z.boolean().optional() },
    },
    async ({ name, full }: { name: string; full?: boolean }) =>
      text(await runQuery(root, "who_uses", { name, full })),
  );

  server.registerTool(
    "file_outline",
    {
      description:
        "Signatures of the symbols in a file, without their bodies. Far cheaper than reading the whole file.",
      inputSchema: { file: z.string() },
    },
    async ({ file }: { file: string }) =>
      text(await runQuery(root, "file_outline", { file })),
  );

  server.registerTool(
    "already_exists",
    {
      description:
        "Before writing new code, check whether something matching these keywords already exists — reuse it instead of duplicating. " +
        "Matching is keyword-substring, not semantic: prefer 1-2 short, distinctive keywords over a full sentence, and retry with " +
        "different/narrower keywords if the first query returns nothing relevant (common domain words can bury the real match).",
      inputSchema: { query: z.string() },
    },
    async ({ query }: { query: string }) =>
      text(await runQuery(root, "already_exists", { query })),
  );

  server.registerTool(
    "dead_code",
    {
      description:
        "List code unreachable from any entry point (entry points auto-detected from package.json main/bin/exports), " +
        "including dead islands (clusters that only reference each other) and whole dead files, ranked HIGH/MEDIUM/LOW " +
        "by how safe they are to remove, each with a reason. References resolve tsconfig path aliases, JSX, types and " +
        "re-export barrels. Candidates already grep non-source files (JSON/YAML/config/" +
        "templates) and flag any name found there as a possible reflective use. Still a signal, not a verdict: it can't " +
        "see all dynamic usage (React.lazy/import(), string-based access) — verify LOW (exported/method) ones before removing.",
      inputSchema: { subdir: z.string().optional() },
    },
    async ({ subdir }: { subdir?: string }) =>
      text(await runQuery(root, "dead_code", { subdir })),
  );

  server.registerTool(
    "file_dependencies",
    {
      description:
        "What a file imports and what imports it, from the precomputed import graph. Use this to jump straight to related files instead of grepping or reading the whole project.",
      inputSchema: { file: z.string() },
    },
    async ({ file }: { file: string }) =>
      text(await runQuery(root, "file_dependencies", { file })),
  );

  server.registerTool(
    "explain_symbol",
    {
      description:
        "Show a symbol's neighborhood in the call graph: what references it (callers) and what it references (callees), each with file:line. Use this to understand how a function/class fits together and gather just the relevant code, instead of reading whole files. Cross-file within a language; for non-TypeScript languages edges are name-based (may over-include).",
      inputSchema: { name: z.string() },
    },
    async ({ name }: { name: string }) =>
      text(await runQuery(root, "explain_symbol", { name })),
  );

  server.registerTool(
    "symbol_path",
    {
      description:
        "Find the shortest chain of calls/references connecting one symbol to another — 'how does X reach Y'. Returns the symbols along the path with file:line, or reports they are not connected.",
      inputSchema: { from: z.string(), to: z.string() },
    },
    async ({ from, to }: { from: string; to: string }) =>
      text(await runQuery(root, "symbol_path", { from, to })),
  );

  // Prompts show up as typeable slash commands in Claude Code (tools do not).
  // Each one just asks Claude to run the matching Sens tool.
  server.registerPrompt(
    "map",
    { title: "Sens: project map", description: "Get a compact map of the project via Sens." },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Use the sens `project_map` tool to show a compact map of this project, then summarize it briefly.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "dead-code",
    { title: "Sens: dead code", description: "List unused-code candidates via Sens." },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Use the sens `dead_code` tool to list unused-code candidates. Note they are candidates to verify before deleting.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "find",
    {
      title: "Sens: find symbol",
      description: "Find where a symbol is defined.",
      argsSchema: { name: z.string() },
    },
    ({ name }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use the sens \`find_symbol\` tool to locate \`${name}\` and show its definition and signature.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "explain",
    {
      title: "Sens: explain symbol",
      description: "Show a symbol's callers and callees from the call graph.",
      argsSchema: { name: z.string() },
    },
    ({ name }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use the sens \`explain_symbol\` tool on \`${name}\` to show what calls it and what it calls, then summarize how it fits into the code.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "exists",
    {
      title: "Sens: already exists?",
      description: "Check if functionality already exists before writing it.",
      argsSchema: { query: z.string() },
    },
    ({ query }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Before writing new code, use the sens \`already_exists\` tool to check whether something matching "${query}" already exists, so we reuse instead of duplicating.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "dashboard",
    {
      title: "Sens: open web dashboard",
      description: "Launch the local web dashboard with the interactive project graph.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Open the Sens web dashboard so I can see the project graph. Run the `sens dashboard` command (it starts a local web server) as a BACKGROUND process — do not wait on it — then tell me the http://localhost:4319 URL to open. If `sens` is not on PATH, run the installed Sens build's `dist/cli.js dashboard` with node instead.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "rules",
    {
      title: "Sens: working rules",
      description: "Load the coding rules (reuse over duplicate, no orphan code) and follow them.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Follow these Sens working rules for the rest of this session, using the sens tools to verify them:\n\n" +
              AGENT_RULES,
          },
        },
      ],
    }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
