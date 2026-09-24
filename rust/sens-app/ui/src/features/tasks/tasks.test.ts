import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../ipc/types";
import { afterEvent, inOrder, shellEnding, tally, taskTime, taskUsage, type Calls, type Task } from "./tasks";

function run(events: [AgentEvent, number?][]) {
  const calls: Calls = new Map();
  let tasks = new Map<string, Task>();
  for (const [event, at = 0] of events) tasks = afterEvent(tasks, calls, event, at);
  return tasks;
}

describe("task events", () => {
  it("gives a command the text of the tool call that launched it, and where it writes", () => {
    const tasks = run([
      [{ kind: "tool", name: "Bash", id: "call-1", input: { command: "npm test" } }],
      [{ kind: "taskStarted", id: "t1", runner: "local_bash", description: "Tests", tool: "call-1" }, 1000],
      [{ kind: "toolDone", id: "call-1", output: "Output is being written to: C:/x/tasks/t1.output", detail: { backgroundTaskId: "t1" } }],
    ]);
    expect(tasks.get("t1")).toMatchObject({ input: { command: "npm test" }, output: "C:/x/tasks/t1.output", status: "running", began: 1000 });
  });

  it("follows progress and keeps the last numbers unless the end brings its own", () => {
    const tasks = run([
      [{ kind: "taskStarted", id: "t2", runner: "local_agent", description: "Revisar" }, 0],
      [{ kind: "taskProgress", id: "t2", doing: "Leyendo", tools: 3, tokens: 900, millis: 4000 }],
      [{ kind: "taskEnded", id: "t2", status: "completed", summary: "Hecho" }, 5000],
    ]);
    expect(tasks.get("t2")).toMatchObject({ status: "completed", ended: 5000, summary: "Hecho", tools: 3, millis: 4000 });
  });

  it("leaves the tasks alone for events that are not about them", () => {
    const calls: Calls = new Map();
    const tasks = new Map<string, Task>();
    expect(afterEvent(tasks, calls, { kind: "text" }, 0)).toBe(tasks);
    expect(afterEvent(tasks, calls, { kind: "taskProgress", id: "nobody" }, 0)).toBe(tasks);
    expect(afterEvent(tasks, calls, { kind: "tool", name: "Read", id: "x" }, 0)).toBe(tasks);
    expect(calls.size).toBe(0);
  });
});

describe("what a task says", () => {
  const base = run([[{ kind: "taskStarted", id: "t", runner: "local_bash", description: "d" }, 1000]]).get("t")!;

  it("times a running task by the clock and a finished one by what it took", () => {
    expect(taskTime(base, 3700)).toBe("2 s");
    expect(taskTime({ ...base, status: "completed", millis: 90000 }, 0)).toBe("1 min 30 s");
    expect(taskTime({ ...base, status: "completed", ended: 1500 }, 0)).toBe("0,5 s");
  });

  it("says what a subagent is doing and what it used", () => {
    expect(taskUsage(base)).toBe("Trabajando…");
    expect(taskUsage({ ...base, status: "completed", tools: 1, tokens: 12500 })).toBe("1 herramienta · 12,5k tokens");
  });

  it("ends a command with its exit code", () => {
    expect(shellEnding(base)).toBe("");
    expect(shellEnding({ ...base, status: "stopped" })).toBe("Detenido");
    expect(shellEnding({ ...base, status: "failed", summary: "exit code 2" })).toBe("Terminó con error · código 2");
    expect(shellEnding({ ...base, status: "completed", summary: "exit code 0" })).toBe("Código de salida 0");
    expect(shellEnding({ ...base, status: "completed" })).toBe("Terminado");
  });

  it("puts running tasks first, then the newest, and counts them", () => {
    const tasks = new Map([
      ["old", { ...base, id: "old", status: "completed", began: 1 }],
      ["new", { ...base, id: "new", status: "completed", began: 3 }],
      ["live", { ...base, id: "live", began: 2 }],
    ]);
    expect(inOrder(tasks).map((task) => task.id)).toEqual(["live", "new", "old"]);
    expect(tally(tasks)).toBe("1 en marcha");
    expect(tally(new Map([["old", tasks.get("old")!]]))).toBe("1 tarea");
    expect(tally(new Map())).toBe("");
  });
});
