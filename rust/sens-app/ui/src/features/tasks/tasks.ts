import type { AgentEvent } from "../../ipc/types";
import { compact, plural, seconds, whole } from "../../shared/format.js";

// What the model runs in the background: subagents and commands it leaves
// running, told by the agent's task events.
export const TASK_EVENTS = new Set(["taskStarted", "taskProgress", "taskEnded"]);
const TASK_TOOLS = new Set(["Bash", "PowerShell", "Agent", "Task"]);
const OUTPUT_AT = /written to: (.+?\.output)\b/;
export const TASK_STATE: Record<string, string> = { running: "running", completed: "done", failed: "failed", stopped: "stopped" };

export interface Task {
  id: string;
  runner: string;
  description: string;
  prompt: string;
  // The tool call that launched it, for a command's text.
  input: Record<string, unknown>;
  status: string;
  began: number;
  ended: number;
  doing: string;
  last: string;
  tools: number;
  tokens: number;
  millis: number;
  summary: string;
  // Where a command writes what it prints.
  output: string;
}

export type Calls = Map<string, Record<string, unknown>>;

export const isShell = (task: Task) => task.runner === "local_bash";
export const isAgent = (task: Task) => task.runner.includes("agent");
export const isRunning = (task: Task) => task.status === "running";

function changed(tasks: Map<string, Task>, id: string, change: Partial<Task>) {
  const task = tasks.get(id);
  if (!task) return tasks;
  return new Map(tasks).set(id, { ...task, ...change });
}

// The tasks after one agent event: the same map when nothing about them
// changed, a new one when something did. `calls` remembers the tool calls that
// may launch one.
export function afterEvent(tasks: Map<string, Task>, calls: Calls, event: AgentEvent, at: number): Map<string, Task> {
  switch (event.kind) {
    case "tool":
      if (TASK_TOOLS.has(event.name ?? "")) calls.set(event.id ?? "", event.input || {});
      return tasks;
    case "toolDone": {
      const id = event.detail?.backgroundTaskId ?? "";
      const path = String(event.output || "").match(OUTPUT_AT)?.[1];
      const task = tasks.get(id);
      return task && path && !task.output ? changed(tasks, id, { output: path }) : tasks;
    }
    case "taskStarted":
      return new Map(tasks).set(event.id ?? "", {
        id: event.id ?? "",
        runner: event.runner ?? "",
        description: event.description ?? "",
        prompt: event.prompt ?? "",
        input: calls.get(event.tool ?? "") || {},
        status: "running",
        began: at,
        ended: 0,
        doing: "",
        last: "",
        tools: 0,
        tokens: 0,
        millis: 0,
        summary: "",
        output: "",
      });
    case "taskProgress":
      return changed(tasks, event.id ?? "", {
        doing: event.doing,
        last: event.last,
        tools: event.tools,
        tokens: event.tokens,
        millis: event.millis,
      });
    case "taskEnded": {
      const task = tasks.get(event.id ?? "");
      if (!task) return tasks;
      return changed(tasks, task.id, {
        status: event.status,
        ended: at,
        summary: event.summary || task.summary,
        output: event.output || task.output,
        ...(event.millis ? { tools: event.tools, tokens: event.tokens, millis: event.millis } : {}),
      });
    }
    default:
      return tasks;
  }
}

// Running ones first, then the newest.
export const inOrder = (tasks: Map<string, Task>) =>
  [...tasks.values()].sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || b.began - a.began);

export function taskTime(task: Task, now: number) {
  if (isRunning(task)) return seconds(whole(now - task.began));
  if (task.millis) return seconds(task.millis);
  return task.ended > task.began ? seconds(task.ended - task.began) : "";
}

export function taskUsage(task: Task) {
  return [
    isRunning(task) && (task.doing || "Trabajando…"),
    task.tools && plural(task.tools, "herramienta", "herramientas"),
    task.tokens && `${compact(task.tokens)} tokens`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function shellEnding(task: Task) {
  if (isRunning(task)) return "";
  if (task.status === "stopped") return "Detenido";
  const code = task.summary.match(/exit code (-?\d+)/)?.[1];
  if (task.status === "failed") return code ? `Terminó con error · código ${code}` : "Terminó con error";
  return code ? `Código de salida ${code}` : "Terminado";
}

export function tally(tasks: Map<string, Task>) {
  const running = [...tasks.values()].filter(isRunning).length;
  if (running) return `${running} en marcha`;
  return tasks.size ? plural(tasks.size, "tarea", "tareas") : "";
}
