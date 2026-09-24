import { createStore } from "zustand/vanilla";
import type { AgentEvent } from "../../ipc/types";
import { afterEvent, isRunning, type Calls, type Task } from "./tasks";

// The open session's background tasks. `now` is the clock the running ones are
// timed with; it moves once a second while one runs and the panel is on screen.
export const tasks = createStore(() => ({
  tasks: new Map<string, Task>(),
  now: Date.now(),
}));

const calls: Calls = new Map();

export function noteTask(event: AgentEvent, at = Date.now()) {
  const before = tasks.getState().tasks;
  const after = afterEvent(before, calls, event, at);
  if (after !== before) tasks.setState({ tasks: after, now: Date.now() });
}

export function forgetTasks() {
  calls.clear();
  tasks.setState({ tasks: new Map() });
}

// Whatever Rust no longer runs, after a replay, was stopped.
export function settleTasks(alive: string[]) {
  const live = new Set(alive);
  const before = tasks.getState().tasks;
  const after = new Map(before);
  for (const task of before.values()) {
    if (isRunning(task) && !live.has(task.id)) after.set(task.id, { ...task, status: "stopped" });
  }
  tasks.setState({ tasks: after, now: Date.now() });
}

export const tickTasks = () => tasks.setState({ now: Date.now() });

export const runningTasks = () => [...tasks.getState().tasks.values()].filter(isRunning).length;
