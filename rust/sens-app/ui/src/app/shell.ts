import { createStore } from "zustand/vanilla";
import { store, stored } from "../shared/storage.js";

const RAIL_CLOSED = "sens.rail.closed";
const SIZES = "sens.sizes";

export type Tool = "files" | "changes" | "web" | "tasks";

// How the window is laid out: the rail folded or not, the tool panel open and
// which tool it shows, the file tree beside the viewer, and the widths the
// splitters were dragged to (kept across launches). `sizing` while a splitter
// moves, so nothing animates under the pointer.
export const shell = createStore(() => ({
  railClosed: stored(RAIL_CLOSED, false) === true,
  toolsOpen: false,
  tool: "files" as Tool,
  treeShown: true,
  sizes: stored(SIZES, {}) as Record<string, number>,
  sizing: false,
}));

const set = shell.setState;

export const panelShows = (tool: Tool) => {
  const { toolsOpen, tool: shown } = shell.getState();
  return toolsOpen && shown === tool;
};

// What each tool does as it comes on screen (read its data again, take the
// focus); the app wires them, so the tools do not depend on the shell.
const entering: Partial<Record<Tool, () => void>> = {};
export const whenShown = (tool: Tool, enter: () => void) => void (entering[tool] = enter);

export function showTool(tool: Tool) {
  set({ toolsOpen: true, tool });
  entering[tool]?.();
}

export const closeTools = () => set({ toolsOpen: false });

export function toggleRail() {
  const railClosed = !shell.getState().railClosed;
  store(RAIL_CLOSED, railClosed);
  set({ railClosed });
}

export const toggleTree = () => set(({ treeShown }) => ({ treeShown: !treeShown }));

// A width dragged to, or 0 to go back to the layout's own.
export function keepSize(name: string, width: number) {
  set(({ sizes }) => {
    const next = { ...sizes };
    if (width) next[name] = width;
    else delete next[name];
    store(SIZES, next);
    return { sizes: next };
  });
}

export const sizing = (on: boolean) => set({ sizing: on });
