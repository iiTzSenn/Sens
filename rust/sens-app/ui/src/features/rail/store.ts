import { createStore } from "zustand/vanilla";
import { commands } from "../../ipc/commands";
import type { SessionSummary, Workspace } from "../../ipc/types";
import { store, stored } from "../../shared/storage.js";
import { project } from "../project/store";

const FOLDED = "sens.rail.folded";

// The projects Sens worked in, most recently active first, each with its
// sessions (null until they are first read); the projects the user folded,
// kept across launches; and why the list could not be read or changed.
export const rail = createStore(() => ({
  spaces: null as Workspace[] | null,
  folded: new Set<string>([].concat(stored(FOLDED, []))),
  fault: "",
}));

const set = rail.setState;

// A fault met just before the list is read again, shown once it is.
let owed = "";
const naming = new Set<string>();

export async function loadRail() {
  try {
    const spaces = await commands.workspaces();
    set({ spaces, fault: owed });
  } catch (reason) {
    set({ fault: owed || String(reason) });
  }
  owed = "";
}

export const oweRail = (reason: unknown) => void (owed = String(reason));
export const failRail = (reason: unknown) => set({ fault: String(reason) });

export function fold(root: string, shut: boolean) {
  set(({ folded }) => {
    const next = new Set(folded);
    if (shut) next.add(root);
    else next.delete(root);
    store(FOLDED, [...next]);
    return { folded: next };
  });
}

// The project a session belongs to: the open one, or whichever lists it.
function homeOf(id: string) {
  const { root, session } = project.getState();
  if (id === session) return root;
  return rail.getState().spaces?.find((space) => space.sessions.some((one) => one.id === id))?.root;
}

// When a turn ends the model may title the session (Rust decides whether it
// still needs one); the list shows the title once there is one.
export async function nameSession(id: string) {
  const home = homeOf(id);
  if (!home || naming.has(id)) return;
  naming.add(id);
  const title = await commands.titleSession(home, id).catch(() => null);
  naming.delete(id);
  if (title) await loadRail();
}

// Each change reads the list again, and says why if it failed.
async function change(work: () => Promise<unknown>) {
  await work().catch(oweRail);
  await loadRail();
}

export const renameSession = (home: string, id: string, title: string) => change(() => commands.renameSession(home, id, title));

export const archiveSession = (home: string, summary: SessionSummary) =>
  change(() => commands.archiveSession(home, summary.id, !summary.archived));

// Whether the session deleted was the one on screen: then a new one of its
// project takes its place.
export async function deleteSession(home: string, id: string) {
  const { root, session } = project.getState();
  try {
    await commands.deleteSession(home, id);
  } catch (reason) {
    oweRail(reason);
    await loadRail();
    return false;
  }
  if (home === root && id === session) return true;
  await loadRail();
  return false;
}
