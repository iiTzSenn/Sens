import type { Finished, Link, ToolDetail, ToolInput, Todo } from "../../ipc/types";
import { compact, seconds } from "../../shared/format.js";
import { ICONS } from "../../shared/icons.js";
import { addedRows, patchRows, type Row } from "../../shared/rows";
import { project } from "../project/store";

// How a tool call reads in a step: its icon (or a site's favicon), a verb, what
// it acts on, and whether that is a path to open; `ask` is how a permission
// question names it.
export interface Look {
  icon: string;
  verb: string;
  target: string;
  mono?: boolean;
  link?: string;
  site?: string;
  meta?: string;
  ask?: string;
}

// Tools the chat does not show as steps: their questions or plans come as asks.
export const SILENT = new Set(["ToolSearch", "AskUserQuestion", "ExitPlanMode"]);
export const EDITS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
export const SHELLS = new Set(["Bash", "PowerShell"]);

// A path inside the open project, relative to it; any other as it came.
export function relative(path: string) {
  if (!path) return "";
  const { work: root } = project.getState();
  const clean = String(path).replace(/\\/g, "/");
  const base = root.replace(/\\/g, "/").replace(/\/$/, "");
  const inside = base && clean.toLowerCase().startsWith(`${base.toLowerCase()}/`);
  return inside ? clean.slice(base.length + 1) : clean;
}

export const oneLine = (text: unknown) => String(text || "").replace(/\s+/g, " ").trim();

export const progressOf = (todos: Todo[] = []) => `${todos.filter((todo) => todo.status === "completed").length}/${todos.length}`;

function pathLook(icon: string, verb: string, input: ToolInput): Look {
  const target = relative(input.file_path || input.notebook_path || "");
  return { icon, verb, target, mono: true, link: target };
}

function mcpLook(name: string): Look {
  const [, server, tool] = name.split("__");
  return { icon: ICONS.plug, verb: server, target: tool || "", mono: true, ask: `usar ${server}` };
}

const LOOKS: Record<string, (input: ToolInput) => Look> = {
  Read: (input) => pathLook(ICONS.fileText, "Leer", input),
  Edit: (input) => pathLook(ICONS.pencil, "Editar", input),
  MultiEdit: (input) => pathLook(ICONS.pencil, "Editar", input),
  NotebookEdit: (input) => pathLook(ICONS.pencil, "Editar", input),
  Write: (input) => pathLook(ICONS.filePlus, "Escribir", input),
  Bash: (input) => ({ icon: ICONS.terminal, verb: "Ejecutar", target: oneLine(input.command), mono: true }),
  PowerShell: (input) => ({ icon: ICONS.terminal, verb: "Ejecutar", target: oneLine(input.command), mono: true }),
  Grep: (input) => ({ icon: ICONS.search, verb: "Buscar", target: String(input.pattern ?? ""), mono: true, meta: input.path ? `en ${relative(input.path)}` : "" }),
  Glob: (input) => ({ icon: ICONS.files, verb: "Listar", target: String(input.pattern ?? ""), mono: true }),
  WebFetch: (input) => ({ icon: ICONS.globe, site: input.url, verb: "Leer", target: String(input.url ?? ""), mono: true, ask: "abrir" }),
  WebSearch: (input) => ({ icon: ICONS.globe, verb: "Buscar en la web", target: String(input.query ?? "") }),
  TodoWrite: (input) => ({ icon: ICONS.listChecks, verb: "Tareas", target: progressOf(input.todos) }),
  Task: (input) => ({ icon: ICONS.split, verb: "Delegar", target: input.description || input.subagent_type || "" }),
  Agent: (input) => ({ icon: ICONS.split, verb: "Delegar", target: input.description || input.subagent_type || "" }),
  Skill: (input) => ({ icon: ICONS.book, verb: "Usar skill", target: String(input.skill || input.command || "") }),
  mcp__sens__read_terminal: () => ({ icon: ICONS.terminal, verb: "Leer la terminal", target: "" }),
};

export function describe(name: string, input: ToolInput = {}): Look {
  if (LOOKS[name]) return LOOKS[name](input);
  if (name.startsWith("mcp__")) return mcpLook(name);
  return { icon: ICONS.wrench, verb: name, target: "" };
}

// What the live line says while a tool runs.
export function statusOf(name: string, input: ToolInput) {
  const look = describe(name, input);
  return [look.verb, look.target].filter(Boolean).join(" · ");
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const consulting = (links: Link[]) => (links.length === 1 ? `Consultando ${hostOf(links[0].url)}` : `Revisando ${links.length} fuentes`);

// What an edit changed, as rows: from the patch Claude Code reports, or every
// line of a file it created. `path` is relative to the project.
export interface Edit {
  path: string;
  rows: Row[];
  added: number[];
  plus: number;
  minus: number;
}

export function editOf(name: string, input: ToolInput, detail: ToolDetail | null): Edit | null {
  const path = relative(input.file_path || detail?.filePath || "");
  const patch = Array.isArray(detail?.structuredPatch) ? detail.structuredPatch : [];
  if (EDITS.has(name) && patch.length) return { path, ...patchRows(patch) };
  if (name === "Write" && detail?.type === "create") {
    const rows = addedRows(detail.content ?? input.content ?? "");
    return { path, rows, added: rows.map((row) => row.num!), plus: rows.length, minus: 0 };
  }
  return null;
}

// The lines a search printed, without its own header or "nothing found".
export const hitsOf = (output: string) =>
  String(output || "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line && !/^Found \d+ /.test(line) && !/^No (files|matches) found/.test(line));

export const searchSummary = (output: string) =>
  String(output || "")
    .replace(/^Web search results for query:.*\n+/, "")
    .replace(/^Links: \[.*\]\n*/m, "")
    .trim();

// How long a turn took and what it wrote, under the reply.
export const FOOT_JOIN = " · ";
export const TOKENS = " tokens";

export const compactedLine = (before: number, auto: boolean) =>
  [auto ? "Claude Code compactó la conversación" : "Conversación compactada", before ? `tenía ${compact(before)}${TOKENS}` : ""].filter(Boolean).join(FOOT_JOIN);

export const footOf = (event: Finished) =>
  [event.millis ? seconds(event.millis) : "", event.tokensOut ? `${compact(event.tokensOut)}${TOKENS}` : "", event.stopped ? "detenido" : ""]
    .filter(Boolean)
    .join(FOOT_JOIN);
