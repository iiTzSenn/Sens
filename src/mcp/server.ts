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
  formatFileDependencies,
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
    {
      instructions: [
        "Sens indexes this project so you can query it instead of reading files wholesale.",
        "",
        "- Orient with `project_map` first. Don't open files just to see what's there.",
        "- Use `find_symbol`, `who_uses`, and `file_outline` instead of grep or reading whole files.",
        "- Use `file_dependencies` to jump between related files (what a file imports / what imports it) instead of reading import statements by hand.",
        "- `who_uses` on a heavily-used symbol returns a partial summary (busiest files) by default to save tokens. " +
          "That summary is NOT the full list \u2014 before renaming or editing every usage, call it again with " +
          "full:true so you don't silently miss files.",
        "- Before writing new code, call `already_exists` with your intended functionality. " +
          "Its matching is keyword-substring, not semantic: if a natural-language query returns nothing relevant, " +
          "retry with 1-2 short, distinctive keywords instead of a full sentence — common domain words " +
          '(e.g. "order", "user") can bury the real match under unrelated results with the same generic word.',
        "- `dead_code` results are candidates, not certainties. Before deleting anything it flags, check for dynamic usage " +
          "it cannot see: `React.lazy(() => import(...))`, other dynamic `import()` calls, string-based/reflective access, " +
          "or framework auto-imports. When in doubt, grep the exact symbol name across the repo as a final check.",
      ].join("\n"),
    },
  );
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
        "List every place a symbol is used, so you can edit it safely without grepping. " +
        "For heavily-used symbols this defaults to a partial summary (busiest files) to save tokens — " +
        "pass full:true to get every call site before renaming/editing all usages, so you don't miss any.",
      inputSchema: { name: z.string(), full: z.boolean().optional() },
    },
    async ({ name, full }) =>
      text(formatWhoUses((await getEngine()).whoUses(name), { full })),
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
        "Before writing new code, check whether something matching these keywords already exists — reuse it instead of duplicating. " +
        "Matching is keyword-substring, not semantic: prefer 1-2 short, distinctive keywords over a full sentence, and retry with " +
        "different/narrower keywords if the first query returns nothing relevant (common domain words can bury the real match).",
      inputSchema: { query: z.string() },
    },
    async ({ query }) =>
      text(formatSymbols((await getEngine()).alreadyExists(query))),
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
    async ({ subdir }) =>
      text(formatDeadCode((await getEngine()).deadCode(subdir))),
  );

  server.registerTool(
    "file_dependencies",
    {
      description:
        "What a file imports and what imports it, from the precomputed import graph. Use this to jump straight to related files instead of grepping or reading the whole project.",
      inputSchema: { file: z.string() },
    },
    async ({ file }) =>
      text(formatFileDependencies((await getEngine()).fileDependencies(file))),
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
