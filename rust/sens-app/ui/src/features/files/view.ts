import { createStore } from "zustand/vanilla";
import { commands } from "../../ipc/commands";
import { legacy } from "../../legacy/bridge";
import { MARKDOWN, PAGE } from "../../shared/format.js";
import { project } from "../project/store";
import { showSite } from "../web/store";
import { revealFile } from "./store";

export type Mode = "source" | "view";

// What the file panel shows: a text under its name (a project file, an
// artifact, a skill), as code or, for Markdown, as a page. `opened` names the
// project file it is, so the tree marks it and the agent's edits show on it;
// `home` is the folder its web preview serves from. `shown` counts what was
// put on screen, so each one starts at its top.
export const viewer = createStore(() => ({
  title: "",
  text: "",
  home: "",
  opened: "",
  mode: "source" as Mode,
  shown: 0,
}));

const set = viewer.setState;

// Markdown reads as a page; an HTML page has its view in the web panel.
export const viewOf = (title: string) => (MARKDOWN.test(title) ? "reading" : PAGE.test(title) ? "site" : "");

// A file opened or a project left makes every read in flight stale.
let reads = 0;

export function present(title: string, text: string, home: string, opened = "") {
  reads++;
  const mode: Mode = viewOf(title) === "reading" ? "view" : "source";
  set(({ shown }) => ({ title, text, home, opened, mode, shown: shown + 1 }));
}

// Reads a project file into the panel. Opening again the file on screen keeps
// it as code if it was read as code.
export async function openFile(path: string) {
  const { root } = project.getState();
  const { opened, mode } = viewer.getState();
  const mine = ++reads;
  revealFile(path);
  const text = await commands.openFile(root, path).catch(String);
  if (mine !== reads) return;
  present(path, text, root, path);
  if (opened === path && mode === "source") set({ mode: "source" });
}

// A file opened from elsewhere (the chat, the changes): the panel turns to Ficheros.
export function showFile(path: string) {
  legacy.showTool("files");
  return openFile(path);
}

export function setMode(mode: Mode) {
  const { title, home } = viewer.getState();
  if (mode === "view" && viewOf(title) === "site") return void showSite(title, home);
  set({ mode });
}

export function forgetViewer() {
  reads++;
  set(({ shown }) => ({ title: "", text: "", home: "", opened: "", mode: "source", shown: shown + 1 }));
}
