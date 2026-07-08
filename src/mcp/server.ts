import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createEngine } from "../core.js";
import { VERSION } from "../index.js";
import { AGENT_RULES } from "../rules.js";
import { logUsage } from "../usage.js";
import {
  formatMap,
  formatSymbols,
  formatWhoUses,
  formatDeadCode,
  formatFileDependencies,
  formatExplain,
  formatPath,
} from "../format.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/**
 * Start the Sens MCP server over stdio.
 *
 * The index is (re)built per tool call via `createEngine`, which reuses the
 * on-disk cache when file mtimes are unchanged — so answers stay fresh across
 * an editing session without re-parsing when nothing changed.
 */
export async function startMcpServer(root: string): Promise<void> {
  const server = new McpServer(
    { name: "sens", version: VERSION },
    { instructions: AGENT_RULES },
  );
  const getEngine = async () => (await createEngine(root)).engine;

  // Wrap a tool handler so every call the model makes is recorded to the usage
  // log first — this is how we can tell whether Sens is actually being used.
  const track =
    <A extends Record<string, unknown>>(
      tool: string,
      handler: (args: A) => Promise<ReturnType<typeof text>>,
    ) =>
    (args: A): Promise<ReturnType<typeof text>> => {
      logUsage(root, tool, args);
      return handler(args);
    };

  server.registerTool(
    "project_map",
    {
      description:
        "Compact map of the project: one line per file with its exported symbols. Use this to orient yourself instead of reading many files.",
      inputSchema: { subdir: z.string().optional() },
    },
    track("project_map", async ({ subdir }: { subdir?: string }) =>
      text(formatMap((await getEngine()).map(subdir))),
    ),
  );

  server.registerTool(
    "find_symbol",
    {
      description:
        "Locate where a symbol is defined: returns file:line and its signature. Replaces grep.",
      inputSchema: { name: z.string() },
    },
    track("find_symbol", async ({ name }: { name: string }) =>
      text(formatSymbols((await getEngine()).findSymbol(name))),
    ),
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
    track("who_uses", async ({ name, full }: { name: string; full?: boolean }) =>
      text(formatWhoUses((await getEngine()).whoUses(name), { full })),
    ),
  );

  server.registerTool(
    "file_outline",
    {
      description:
        "Signatures of the symbols in a file, without their bodies. Far cheaper than reading the whole file.",
      inputSchema: { file: z.string() },
    },
    track("file_outline", async ({ file }: { file: string }) =>
      text(formatSymbols((await getEngine()).fileOutline(file))),
    ),
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
    track("already_exists", async ({ query }: { query: string }) =>
      text(formatSymbols((await getEngine()).alreadyExists(query))),
    ),
  );

  server.registerTool(
    "dead_code",
    {
      description:
        "List unused symbols (candidates). Verify before deleting: this can't see dynamic usage " +
        "(React.lazy/import(), string-based access, reflection) or framework auto-imports — grep the exact " +
        "symbol name across the repo if unsure before removing it.",
      inputSchema: { subdir: z.string().optional() },
    },
    track("dead_code", async ({ subdir }: { subdir?: string }) =>
      text(formatDeadCode((await getEngine()).deadCode(subdir))),
    ),
  );

  server.registerTool(
    "file_dependencies",
    {
      description:
        "What a file imports and what imports it, from the precomputed import graph. Use this to jump straight to related files instead of grepping or reading the whole project.",
      inputSchema: { file: z.string() },
    },
    track("file_dependencies", async ({ file }: { file: string }) =>
      text(formatFileDependencies((await getEngine()).fileDependencies(file))),
    ),
  );

  server.registerTool(
    "explain_symbol",
    {
      description:
        "Show a symbol's neighborhood in the call graph: what references it (callers) and what it references (callees), each with file:line. Use this to understand how a function/class fits together and gather just the relevant code, instead of reading whole files. Cross-file within a language; for non-TypeScript languages edges are name-based (may over-include).",
      inputSchema: { name: z.string() },
    },
    track("explain_symbol", async ({ name }: { name: string }) =>
      text(formatExplain((await getEngine()).explain(name))),
    ),
  );

  server.registerTool(
    "symbol_path",
    {
      description:
        "Find the shortest chain of calls/references connecting one symbol to another — 'how does X reach Y'. Returns the symbols along the path with file:line, or reports they are not connected.",
      inputSchema: { from: z.string(), to: z.string() },
    },
    track("symbol_path", async ({ from, to }: { from: string; to: string }) =>
      text(formatPath((await getEngine()).path(from, to), from, to)),
    ),
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
