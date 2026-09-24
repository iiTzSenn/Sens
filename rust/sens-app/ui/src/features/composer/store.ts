import { getCurrentWindow } from "@tauri-apps/api/window";
import { createStore } from "zustand/vanilla";
import { commands } from "../../ipc/commands";
import type { Card, Repo, Settings } from "../../ipc/types";
import { store, stored } from "../../shared/storage.js";
import { forgetChanges } from "../changes/store";
import { chat, notice, send as sendChat, warm as warmChat, warn } from "../chat/store";
import { loadFiles } from "../files/store";
import { openFile, viewer } from "../files/view";
import { chosenCard, models } from "../models/store";
import { forgetEdits, project } from "../project/store";

const EFFORT = "sens.effort";
const THINKING = "sens.thinking";
const MODE = "sens.mode";

export const EFFORT_NAMES: Record<string, string> = { low: "Bajo", medium: "Medio", high: "Alto", xhigh: "Extra", max: "Max" };

export const MODES = [
  { id: "default", label: "Preguntar", said: "Pide permiso antes de editar ficheros o ejecutar comandos." },
  { id: "acceptEdits", label: "Aceptar ediciones", said: "Edita sin preguntar; pide permiso para los comandos." },
  { id: "auto", label: "Automático", said: "Un clasificador aprueba o bloquea cada acción por ti." },
  { id: "plan", label: "Planificar", said: "Explora y propone un plan sin tocar nada." },
  {
    id: "bypassPermissions",
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

// What goes with the next message: effort, thinking and the permission mode
// (kept across launches), the files and pictures attached, and the branch of
// the project, if it is a git repository.
export const composer = createStore(() => ({
  effort: stored(EFFORT, "") as string,
  thinking: stored(THINKING, true) !== false,
  mode: MODES.some((one) => one.id === storedMode) ? (storedMode as string) : "default",
  attached: [] as File[],
  pasted: [] as Picture[],
  repo: null as Repo | null,
  // Files dragged over the window, while they may be dropped here.
  dropping: false,
}));

const set = composer.setState;

export const effortLevels = (card = chosenCard()) => card?.efforts || [];

// The effort chosen when the model offers it, else the model's own.
export function effortNow(card: Card | undefined = chosenCard()) {
  const { effort } = composer.getState();
  return card?.efforts.includes(effort) ? effort : card?.effort || "";
}

export function currentSettings(): Settings {
  const card = chosenCard();
  const { choice } = models.getState();
  const { thinking, mode } = composer.getState();
  return { provider: choice.provider, model: choice.model, effort: effortNow(card), thinking: card?.thinking === "always" || thinking, mode };
}

export const warm = () => warmChat(currentSettings());

export function pickEffort(at: number) {
  const levels = effortLevels();
  const level = levels[Math.min(Math.max(at, 0), levels.length - 1)];
  if (!level || level === effortNow()) return;
  store(EFFORT, level);
  set({ effort: level });
  warm();
}

export function toggleThinking() {
  if (chosenCard()?.thinking === "always") return;
  const thinking = !composer.getState().thinking;
  store(THINKING, thinking);
  set({ thinking });
}

export function chooseMode(id: string) {
  if (!MODES.some((one) => one.id === id)) return;
  store(MODE, id);
  set({ mode: id });
}

export const fileLabel = (file: File) => (file.outside ? file.name : file.path);

export async function attachPaths(paths: string[]) {
  const { root } = project.getState();
  if (!root || !paths.length) return;
  let found;
  try {
    found = await commands.attach(root, paths);
  } catch (reason) {
    return warn(String(reason));
  }
  set(({ attached, pasted }) => {
    const files = [...attached];
    const pictures = [...pasted];
    for (const item of found.items) {
      if (item.kind === "picture") pictures.push({ name: item.name, bytes: item.bytes, mediaType: item.mediaType, url: `data:${item.mediaType};base64,${item.data}` });
      else if (!files.some((file) => file.path === item.path)) files.push(item);
    }
    return { attached: files, pasted: pictures };
  });
  for (const reason of found.refused) warn(reason);
}

const readAsUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });

// Pictures pasted into the message: only the kinds and sizes Claude takes.
export async function takePictures(files: globalThis.File[]) {
  const taken: Picture[] = [];
  for (const file of files) {
    const name = file.name || "imagen pegada";
    if (!PASTEABLE.has(file.type)) {
      warn(`${name} no se puede enviar · solo PNG, JPEG, GIF o WebP`);
      continue;
    }
    if (file.size > PICTURE_CAP) {
      warn(`${name} pasa de 5 MB · redúcela antes de enviarla`);
      continue;
    }
    taken.push({ name, bytes: file.size, mediaType: file.type, url: await readAsUrl(file) });
  }
  set(({ pasted }) => ({ pasted: [...pasted, ...taken] }));
}

export const dropFile = (path: string) => set(({ attached }) => ({ attached: attached.filter((file) => file.path !== path) }));
export const dropPicture = (picture: Picture) => set(({ pasted }) => ({ pasted: pasted.filter((one) => one !== picture) }));
export const forgetClips = () => set({ attached: [], pasted: [] });

export async function readRepo() {
  const { root } = project.getState();
  set({ repo: root ? await commands.repo(root) : null });
}

// A branch switched: the agent's marks go, and what shows files reads them again.
export async function switchTo(name: string) {
  let repo;
  try {
    repo = await commands.checkout(project.getState().root, name);
  } catch (reason) {
    return warn(String(reason));
  }
  set({ repo });
  notice(["rama · ", { bold: repo.branch }]);
  forgetEdits();
  forgetChanges();
  await loadFiles();
  const { opened } = viewer.getState();
  if (opened) await openFile(opened);
}

// A message goes when there is a project, a model and something to say.
export const canSend = (text: string) => Boolean(project.getState().root && models.getState().choice.provider && (text.trim() || composer.getState().pasted.length));

export async function send(text: string) {
  if (chat.getState().busy || !canSend(text)) return;
  const { attached, pasted } = composer.getState();
  const message = {
    text: text.trim(),
    files: attached.map((file) => file.path),
    images: pasted.map((picture) => ({ mediaType: picture.mediaType, data: picture.url.slice(picture.url.indexOf(",") + 1) })),
  };
  forgetClips();
  await sendChat({ message, shownFiles: attached.map(fileLabel), pictures: pasted.map((picture) => picture.url) }, currentSettings());
}

// Files dropped on the window attach to the message, while the chat of a
// project shows.
export function hearDrops() {
  getCurrentWindow().onDragDropEvent(({ payload }) => {
    const { root, view } = project.getState();
    const welcome = Boolean(root) && !view;
    if (payload.type === "enter" || payload.type === "over") {
      if (welcome) set({ dropping: true });
      return;
    }
    set({ dropping: false });
    if (payload.type !== "drop" || !welcome) return;
    attachPaths(payload.paths);
    document.getElementById("task")?.focus();
  });
}

// The branch is read again after every turn: the agent may have committed.
chat.subscribe((now, before) => {
  if (now.ended !== before.ended) readRepo();
});
