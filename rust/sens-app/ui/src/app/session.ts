import { open } from "@tauri-apps/plugin-dialog";
import { commands } from "../ipc/commands";
import { loadShelf } from "../features/artifacts/store";
import { enterCapabilities } from "../features/capabilities/store";
import { forgetChanges } from "../features/changes/store";
import { blank, hello, idle, load } from "../features/chat/store";
import { forgetClips, readRepo, readTrust } from "../features/composer/store";
import { forgetTree, loadFiles } from "../features/files/store";
import { forgetViewer } from "../features/files/view";
import { settle } from "../features/models/store";
import { slideAway } from "../features/panes/motion";
import { close, focused, keptLayout, newPane, other, paneOf, panes, place, setFocus, sideOf, split, type Kept, type Pane, type Setup, type Side } from "../features/panes/store";
import { forgetEdits, project, type View } from "../features/project/store";
import { failRail, fold, loadRail, oweRail, rail } from "../features/rail/store";
import { enterSettings } from "../features/settings/store";
import { forgetSite } from "../features/web/store";

// Where the main area goes: a session of a project, a new one, a view over
// the chat. Opening a project other than the one open resets what shows it.

const LOADS: Record<Exclude<View, "">, () => unknown> = {
  capabilities: enterCapabilities,
  artifacts: loadShelf,
  settings: enterSettings,
};

export function showView(view: View) {
  project.setState({ view });
  if (view) LOADS[view]();
}

export const toChat = () => project.getState().view && showView("");

function leave() {
  forgetEdits();
  forgetSite();
  forgetViewer();
  forgetTree();
  const { view } = project.getState();
  if (view) LOADS[view]();
}

async function arrive() {
  forgetChanges();
  await loadFiles();
}

async function enter(root: string, pane: Pane) {
  pane.desk.setState({ root, session: "" });
  forgetClips(pane);
  idle(true, pane);
  const shown = pane === focused();
  if (shown) leave();
  await commands.remember(root).catch(oweRail);
  await readTrust(pane);
  await readRepo(pane);
  if (shown) await arrive();
}

async function visit(home: string, then: (pane: Pane) => Promise<unknown>, pane: Pane = focused()) {
  toChat();
  try {
    if (home !== pane.desk.getState().root) await enter(home, pane);
    await then(pane);
  } catch (reason) {
    failRail(reason);
  }
}

// A new session in `home`: the empty chat, the message ready to write.
export const draft = (home: string, pane: Pane = focused()) =>
  visit(
    home,
    async (pane) => {
      fold(home, false);
      blank("", pane);
      idle(true, pane);
      hello(pane);
      if (pane === focused()) document.getElementById("task")?.focus();
      await loadRail();
    },
    pane,
  );

export function resume(home: string, id: string) {
  const shown = paneOf(id);
  if (shown) return focusPane(shown).then(toChat);
  return visit(home, (pane) => load(id, pane));
}

export async function focusPane(pane: Pane) {
  if (pane === focused()) return;
  const before = project.getState().root;
  setFocus(pane.id);
  if (pane.desk.getState().root === before) return;
  leave();
  await arrive();
}

const besideSide = (): Side => (split() ? sideOf(other(focused())!) : "right");

export async function openBeside(home: string, id: string, side: Side = besideSide()) {
  toChat();
  const shown = paneOf(id);
  if (shown) return focusPane(shown);
  const before = project.getState().root;
  const pane = newPane(home);
  settle(pane);
  place(pane, side);
  try {
    await commands.remember(home).catch(oweRail);
    await readTrust(pane);
    await readRepo(pane);
    if (home !== before) {
      leave();
      await arrive();
    }
    await load(id, pane);
  } catch (reason) {
    failRail(reason);
  }
}

export async function closePane(pane: Pane) {
  if (!split()) return;
  await slideAway(sideOf(pane) === "left");
  const before = project.getState().root;
  close(pane);
  if (focused().desk.getState().root === before) return;
  leave();
  await arrive();
}

export const dropShown = (pane: Pane, home: string) => (split() ? closePane(pane) : draft(home, pane));

export async function chooseFolder() {
  const picked = await open({ directory: true, title: "Elige la carpeta de trabajo", defaultPath: project.getState().root || undefined });
  if (typeof picked === "string") await draft(picked);
}

// Ctrl+N: a new session where you are, or a folder first.
export function fresh() {
  toChat();
  const { root } = project.getState();
  return root ? draft(root) : chooseFolder();
}

async function restore(kept: Kept) {
  await loadRail();
  const known = ({ root, session }: Setup) =>
    rail.getState().spaces?.some((space) => space.root === root && space.sessions.some((one) => one.id === session));
  const both = kept.panes.filter(known);
  if (both.length < 2) return false;
  await visit(both[0].root, (pane) => load(both[0].session, pane));
  await openBeside(both[1].root, both[1].session, "right");
  panes.getState().open.forEach((pane, at) => {
    const { choice, effort, thinking } = both[at];
    if (choice) pane.desk.setState({ choice, effort, thinking });
    settle(pane);
  });
  const wanted = panes.getState().open[kept.focus];
  if (wanted) await focusPane(wanted);
  return true;
}

// The last project opens where it was left, in a new session.
export async function boot() {
  hello();
  const kept = keptLayout();
  try {
    if (kept && kept.panes.length > 1 && (await restore(kept))) return;
    const last = await commands.lastProject();
    if (last) return draft(last);
  } catch (reason) {
    oweRail(reason);
  }
  await loadRail();
}
