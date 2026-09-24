import { createStore } from "zustand/vanilla";
import type { AgentEvent } from "../../ipc/types";
import { afterEvent, isRunning, type Calls, type Task } from "./tasks";

// The open session's background tasks. `now` is the clock the running ones are
// timed with; it moves once a second while one runs and the panel is on screen.
export const tasks = createStore(() => ({
  tasks: new Map<string, Task>(),
  now: Date.now(),
}));

const kept = new Map<string, { tasks: Map<string, Task>; calls: Calls }>();
let shown = "";

function of(session: string) {
  let one = kept.get(session);
  if (!one) kept.set(session, (one = { tasks: new Map(), calls: new Map() }));
  return one;
}

function put(session: string, after: Map<string, Task>) {
  of(session).tasks = after;
  if (session === shown) tasks.setState({ tasks: after, now: Date.now() });
}

export function showTasksOf(session: string) {
  if (session === shown && tasks.getState().tasks === of(session).tasks) return;
  shown = session;
  tasks.setState({ tasks: of(session).tasks, now: Date.now() });
}

export function noteTask(event: AgentEvent, at = Date.now(), session = shown) {
  const one = of(session);
  const after = afterEvent(one.tasks, one.calls, event, at);
  if (after !== one.tasks) put(session, after);
}

export function forgetTasks(session = shown) {
  kept.delete(session);
  if (session === shown) tasks.setState({ tasks: of(session).tasks });
}

// Whatever Rust no longer runs, after a replay, was stopped.
export function settleTasks(alive: string[], session = shown) {
  const live = new Set(alive);
  const before = of(session).tasks;
  const after = new Map(before);
  for (const task of before.values()) {
    if (isRunning(task) && !live.has(task.id)) after.set(task.id, { ...task, status: "stopped" });
  }
  put(session, after);
}

export const tickTasks = () => tasks.setState({ now: Date.now() });

export const runningTasks = () => [...tasks.getState().tasks.values()].filter(isRunning).length;
