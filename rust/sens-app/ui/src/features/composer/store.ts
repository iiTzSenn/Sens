import { getCurrentWindow } from "@tauri-apps/api/window";
import { createStore } from "zustand/vanilla";
import { commands } from "../../ipc/commands";
import type { Card, Settings } from "../../ipc/types";
import { store, stored } from "../../shared/storage.js";
import { forgetChanges } from "../changes/store";
import { notice, send as sendChat, warm as warmChat, warn, whenTurnEnds } from "../chat/store";
import { loadFiles } from "../files/store";
import { openFile, viewer } from "../files/view";
import { chosenCard } from "../models/store";
import { EFFORT, THINKING, focused, panes, type Pane } from "../panes/store";
import { forgetEdits, project } from "../project/store";
import { failRail, loadRail } from "../rail/store";

const MODE = "sens.mode";

export const BYPASS = "bypassPermissions";

export const EFFORT_NAMES: Record<string, string> = { low: "Bajo", medium: "Medio", high: "Alto", xhigh: "Extra", max: "Max" };

export const MODES = [
  { id: "default", label: "Preguntar", said: "Pide permiso antes de editar ficheros o ejecutar comandos." },
  { id: "acceptEdits", label: "Aceptar ediciones", said: "Edita sin preguntar; pide permiso para los comandos." },
  { id: "auto", label: "Automático", said: "Un clasificador aprueba o bloquea cada acción por ti." },
  { id: "plan", label: "Planificar", said: "Explora y propone un plan sin tocar nada." },
  {
    id: BYPASS,
    label: "Sin control",
    said: "Lo hace todo sin pedir permiso: edita, ejecuta comandos y usa la red. Solo en proyectos de confianza.",
    risky: true,
  },
];

const PASTEABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const PICTURE_CAP = 5 * 1024 * 1024;

// A file attached from the project (or from outside it), and a picture pasted
// or dropped, as the message will carry them.
export interface File {
  path: string;
  name: string;
  bytes: number;
  outside: boolean;
}

export interface Picture {
  name: string;
  bytes: number;
  mediaType: string;
  url: string;
}

const storedMode = stored(MODE, "");

export const composer = createStore(() => ({
  mode: MODES.some((one) => one.id === storedMode) ? (storedMode as string) : "default",
  // Files dragged over the window, while they may be dropped here.
  dropping: false,
}));

const set = composer.setState;
const rootOf = (pane: Pane) => pane.desk.getState().root;
const sharing = (root: string) => panes.getState().open.filter((one) => rootOf(one) === root);

export const effortLevels = (card = chosenCard()) => card?.efforts || [];

// The effort chosen when the model offers it, else the model's own.
export function effortNow(card: Card | undefined = chosenCard(), pane: Pane = focused()) {
  const { effort } = pane.desk.getState();
  return card?.efforts.includes(effort) ? effort : card?.effort || "";
}

export const trustedHere = (pane: Pane = focused()) => Boolean(rootOf(pane)) && pane.desk.getState().trusted === rootOf(pane);

export function modeNow(pane: Pane = focused()) {
  const { mode } = composer.getState();
  return mode === BYPASS && !trustedHere(pane) ? "default" : mode;
}

export function currentSettings(pane: Pane = focused()): Settings {
  const card = chosenCard(pane);
  const { choice, thinking } = pane.desk.getState();
  return { provider: choice.provider, model: choice.model, effort: effortNow(card, pane), thinking: card?.thinking === "always" || thinking, mode: modeNow(pane) };
}

export const warm = (pane: Pane = focused()) => warmChat(currentSettings(pane), pane);

export function pickEffort(at: number, pane: Pane = focused()) {
  const card = chosenCard(pane);
  const levels = effortLevels(card);
  const level = levels[Math.min(Math.max(at, 0), levels.length - 1)];
  if (!level || level === effortNow(card, pane)) return;
  store(EFFORT, level);
  pane.desk.setState({ effort: level });
  warm(pane);
}

export function toggleThinking(pane: Pane = focused()) {
  if (chosenCard(pane)?.thinking === "always") return;
  const thinking = !pane.desk.getState().thinking;
  store(THINKING, thinking);
  pane.desk.setState({ thinking });
}

export function chooseMode(id: string, pane: Pane = focused()) {
  if (!MODES.some((one) => one.id === id)) return;
  if (id === BYPASS && !trustedHere(pane)) return;
  store(MODE, id);
  set({ mode: id });
}

export async function readTrust(pane: Pane = focused()) {
  const root = rootOf(pane);
  pane.desk.setState({ trusted: root && (await commands.projectTrusted(root)) ? root : "" });
}

export async function trustProject(pane: Pane = focused()) {
  const root = rootOf(pane);
  await commands.trustProject(root, true);
  for (const one of sharing(root)) one.desk.setState({ trusted: root });
  chooseMode(BYPASS, pane);
  await loadRail();
}

export async function distrust(root: string) {
  try {
    await commands.trustProject(root, false);
  } catch (reason) {
    return failRail(reason);
  }
  for (const one of sharing(root)) one.desk.setState({ trusted: "" });
  await loadRail();
}

export const fileLabel = (file: File) => (file.outside ? file.name : file.path);

export async function attachPaths(paths: string[], pane: Pane = focused()) {
  const root = rootOf(pane);
  if (!root || !paths.length) return;
  let found;
  try {
    found = await commands.attach(root, paths);
  } catch (reason) {
    return warn(String(reason), pane);
  }
  pane.desk.setState(({ attached, pasted }) => {
    const files = [...attached];
    const pictures = [...pasted];
    for (const item of found.items) {
      if (item.kind === "picture") pictures.push({ name: item.name, bytes: item.bytes, mediaType: item.mediaType, url: `data:${item.mediaType};base64,${item.data}` });
      else if (!files.some((file) => file.path === item.path)) files.push(item);
    }
    return { attached: files, pasted: pictures };
  });
  for (const reason of found.refused) warn(reason, pane);
}

const readAsUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });

// Pictures pasted into the message: only the kinds and sizes Claude takes.
export async function takePictures(files: globalThis.File[], pane: Pane = focused()) {
  const taken: Picture[] = [];
  for (const file of files) {
    const name = file.name || "imagen pegada";
    if (!PASTEABLE.has(file.type)) {
      warn(`${name} no se puede enviar · solo PNG, JPEG, GIF o WebP`, pane);
      continue;
    }
    if (file.size > PICTURE_CAP) {
      warn(`${name} pasa de 5 MB · redúcela antes de enviarla`, pane);
      continue;
    }
    taken.push({ name, bytes: file.size, mediaType: file.type, url: await readAsUrl(file) });
  }
  pane.desk.setState(({ pasted }) => ({ pasted: [...pasted, ...taken] }));
}

export const dropFile = (path: string, pane: Pane = focused()) => pane.desk.setState(({ attached }) => ({ attached: attached.filter((file) => file.path !== path) }));
export const dropPicture = (picture: Picture, pane: Pane = focused()) => pane.desk.setState(({ pasted }) => ({ pasted: pasted.filter((one) => one !== picture) }));
export const forgetClips = (pane: Pane = focused()) => pane.desk.setState({ attached: [], pasted: [] });

const repoLaps = new WeakMap<Pane, number>();

function nextRepoLap(pane: Pane) {
  const mine = (repoLaps.get(pane) ?? 0) + 1;
  repoLaps.set(pane, mine);
  return mine;
}

export async function readRepo(pane: Pane = focused()) {
  const root = rootOf(pane);
  const mine = nextRepoLap(pane);
  const repo = root ? await commands.repo(root) : null;
  if (rootOf(pane) === root && repoLaps.get(pane) === mine) pane.desk.setState({ repo });
}

// A branch switched: the agent's marks go, and what shows files reads them again.
export async function switchTo(name: string, pane: Pane = focused()) {
  const root = rootOf(pane);
  let repo;
  try {
    repo = await commands.checkout(root, name);
  } catch (reason) {
    return warn(String(reason), pane);
  }
  for (const one of sharing(root)) {
    nextRepoLap(one);
    one.desk.setState({ repo });
  }
  notice(["rama · ", { bold: repo.branch }], "", pane);
  if (root !== project.getState().root) return;
  forgetEdits();
  forgetChanges();
  await loadFiles();
  const { opened } = viewer.getState();
  if (opened) await openFile(opened);
}

// A message goes when there is a project, a model and something to say.
export function canSend(text: string, pane: Pane = focused()) {
  const { root, choice, pasted } = pane.desk.getState();
  return Boolean(root && choice.provider && (text.trim() || pasted.length));
}

export async function send(text: string, pane: Pane = focused()) {
  if (pane.chat.getState().busy || !canSend(text, pane)) return;
  const { attached, pasted } = pane.desk.getState();
  const message = {
    text: text.trim(),
    files: attached.map((file) => file.path),
    images: pasted.map((picture) => ({ mediaType: picture.mediaType, data: picture.url.slice(picture.url.indexOf(",") + 1) })),
  };
  forgetClips(pane);
  await sendChat({ message, shownFiles: attached.map(fileLabel), pictures: pasted.map((picture) => picture.url) }, currentSettings(pane), pane);
}

// Files dropped on the window attach to the message, while the chat of a
// project shows.
export function hearDrops() {
  getCurrentWindow().onDragDropEvent(({ payload }) => {
    const pane = focused();
    const welcome = Boolean(rootOf(pane)) && !project.getState().view;
    if (payload.type === "enter" || payload.type === "over") {
      if (welcome) set({ dropping: true });
      return;
    }
    set({ dropping: false });
    if (payload.type !== "drop" || !welcome) return;
    attachPaths(payload.paths, pane);
    document.getElementById("task")?.focus();
  });
}

// The branch is read again after every turn: the agent may have committed.
whenTurnEnds(readRepo);
