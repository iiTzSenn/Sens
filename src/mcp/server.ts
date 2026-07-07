import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createEngine } from "../core.js";
import { VERSION } from "../index.js";
import {
  formatMap,
  formatSymbols,
  formatWhoUses,
  formatDeadCode,
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
  const server = new McpServer({ name: "sens", version: VERSION });
  const getEngine = async () => (await createEngine(root)).engine;

  server.registerTool(
    "project_map",
    {
      description:
        "Compact map of the project: one line per file with its exported symbols. Use this to orient yourself instead of reading many files.",
      inputSchema: { subdir: z.string().optional() },
    },
    async ({ subdir }) => text(formatMap((await getEngine()).map(subdir))),
  );

  server.registerTool(
    "find_symbol",
    {
      description:
        "Locate where a symbol is defined: returns file:line and its signature. Replaces grep.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => text(formatSymbols((await getEngine()).findSymbol(name))),
  );

  server.registerTool(
    "who_uses",
    {
      description:
        "List every place a symbol is used, so you can edit it safely without grepping.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => text(formatWhoUses((await getEngine()).whoUses(name))),
  );

  server.registerTool(
    "file_outline",
    {
      description:
        "Signatures of the symbols in a file, without their bodies. Far cheaper than reading the whole file.",
      inputSchema: { file: z.string() },
    },
    async ({ file }) =>
      text(formatSymbols((await getEngine()).fileOutline(file))),
  );

  server.registerTool(
    "already_exists",
    {
      description:
        "Before writing new code, check whether something matching these keywords already exists — reuse it instead of duplicating.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) =>
      text(formatSymbols((await getEngine()).alreadyExists(query))),
  );

  server.registerTool(
    "dead_code",
    {
      description:
        "List unused symbols (candidates). Verify before deleting: dynamic usage and framework auto-imports may not be detected.",
      inputSchema: { subdir: z.string().optional() },
    },
    async ({ subdir }) =>
      text(formatDeadCode((await getEngine()).deadCode(subdir))),
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
