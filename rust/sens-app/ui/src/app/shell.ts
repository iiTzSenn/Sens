import { createStore } from "zustand/vanilla";
import { store, stored } from "../shared/storage.js";

const RAIL_CLOSED = "sens.rail.closed";
const SIZES = "sens.sizes";

export type Tool = "files" | "changes" | "web" | "tasks";

// Narrower than this, the rail, the chat and the tool panel do not fit side by
// side at their least (180 + 360 + 320 px, as styles.css clamps them).
const ROOMY = "(min-width: 860px)";

// How the window is laid out: the rail folded or not, the tool panel open and
// which tool it shows, the file tree beside the viewer, and the widths the
// splitters were dragged to (kept across launches). `narrow` while the window
// is too narrow for the three panes; `sizing` while a splitter moves, so
// nothing animates under the pointer.
export const shell = createStore(() => ({
  railClosed: stored(RAIL_CLOSED, false) === true,
  narrow: false,
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

type Layout = { railClosed: boolean; narrow: boolean; toolsOpen: boolean };

// The rail is folded when the person folded it, and while a tool is open in a
// narrow window: then it gives the chat and the tool their room, and comes
// back when the tool closes or the window widens.
export const railFolded = ({ railClosed, narrow, toolsOpen }: Layout) => railClosed || (narrow && toolsOpen);

// Unfolding the rail in a narrow window closes the tool that folded it.
export function toggleRail() {
  const state = shell.getState();
  const railClosed = !railFolded(state);
  store(RAIL_CLOSED, railClosed);
  set({ railClosed, toolsOpen: state.toolsOpen && (railClosed || !state.narrow) });
}

// Follows the window's width.
export function watchWidth() {
  const roomy = matchMedia(ROOMY);
  const hear = () => set({ narrow: !roomy.matches });
  hear();
  roomy.addEventListener("change", hear);
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
