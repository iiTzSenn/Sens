import { open } from "@tauri-apps/plugin-dialog";
import { commands } from "../ipc/commands";
import { loadShelf } from "../features/artifacts/store";
import { enterCapabilities } from "../features/capabilities/store";
import { forgetChanges } from "../features/changes/store";
import { blank, hello, idle, load } from "../features/chat/store";
import { forgetClips, readRepo } from "../features/composer/store";
import { forgetTree, loadFiles } from "../features/files/store";
import { forgetViewer } from "../features/files/view";
import { forgetEdits, project, type View } from "../features/project/store";
import { failRail, fold, loadRail, oweRail } from "../features/rail/store";
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

async function enter(root: string) {
  project.setState({ root, session: "" });
  forgetEdits();
  forgetClips();
  forgetSite();
  forgetViewer();
  forgetTree();
  idle(true);
  const { view } = project.getState();
  if (view) LOADS[view]();
  await commands.remember(root).catch(oweRail);
  await readRepo();
  forgetChanges();
  await loadFiles();
}

async function visit(home: string, then: () => Promise<unknown>) {
  toChat();
  try {
    if (home !== project.getState().root) await enter(home);
    await then();
  } catch (reason) {
    failRail(reason);
  }
}

// A new session in `home`: the empty chat, the message ready to write.
export const draft = (home: string) =>
  visit(home, async () => {
    fold(home, false);
    blank("");
    idle(true);
    hello();
    document.getElementById("task")?.focus();
    await loadRail();
  });

export const resume = (home: string, id: string) => visit(home, () => load(id));

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

// The last project opens where it was left, in a new session.
export async function boot() {
  hello();
  try {
    const last = await commands.lastProject();
    if (last) return draft(last);
  } catch (reason) {
    oweRail(reason);
  }
  await loadRail();
}
