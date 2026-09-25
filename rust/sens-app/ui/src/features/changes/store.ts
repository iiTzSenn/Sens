import { createStore } from "zustand/vanilla";
import { commands } from "../../ipc/commands";
import { panelShows } from "../../app/shell";
import { project } from "../project/store";
import { diffedFiles, freshFile, type DiffFile } from "./diff";

// `changed` is null until git answers.
export const changes = createStore(() => ({
  changed: null as DiffFile[] | null,
  versioned: true,
  fault: "",
  unfolded: new Set<string>(),
}));

const set = changes.setState;
const home = () => project.getState().work;

// Each read supersedes the ones before it.
let lap = 0;
let soon = 0;

export async function loadChanges() {
  clearTimeout(soon);
  const mine = ++lap;
  const root = home();
  if (!root) return set({ fault: "" });
  let found;
  try {
    found = await commands.changes(root);
  } catch (reason) {
    if (mine === lap) set({ fault: String(reason) });
    return;
  }
  if (mine !== lap || root !== home()) return;
  set({
    versioned: Boolean(found),
    changed: found ? [...diffedFiles(found.diff), ...found.fresh.map(freshFile)] : [],
    fault: "",
  });
}

// The agent is editing: wait for it to pause before asking git again.
export function soonChanges() {
  clearTimeout(soon);
  soon = window.setTimeout(loadChanges, 400);
}

export function forgetChanges() {
  set({ changed: null, versioned: true, fault: "", unfolded: new Set() });
  if (panelShows("changes")) loadChanges();
}

export function unfold(path: string, open: boolean) {
  set(({ unfolded }) => {
    if (unfolded.has(path) === open) return {};
    const next = new Set(unfolded);
    if (open) next.add(path);
    else next.delete(path);
    return { unfolded: next };
  });
}
