import { getCurrentWindow } from "@tauri-apps/api/window";
import { createStore } from "zustand/vanilla";
import { commands } from "../../ipc/commands";
import type { AttachedFile, Card, Refused, Settings } from "../../ipc/types";
import { store, stored } from "../../shared/storage.js";
import { forgetChanges } from "../changes/store";
import { notice, send as sendChat, warm as warmChat, warn, whenTurnEnds } from "../chat/store";
import { loadFiles } from "../files/store";
import { openFile, viewer } from "../files/view";
import { chosenCard } from "../models/store";
import { EFFORT, ISOLATE, THINKING, focused, panes, workOf, type Pane } from "../panes/store";
import { forgetEdits, project } from "../project/store";
import { failRail, loadRail } from "../rail/store";
import { t } from "./copy";
import { RAW_PICTURE_CAP, fitPicture, readAsUrl, type Fitted } from "./pictures";

const MODE = "sens.mode";

export const BYPASS = "bypassPermissions";

export const MODES: { id: string; risky?: boolean }[] = [{ id: "default" }, { id: "acceptEdits" }, { id: "auto" }, { id: "plan" }, { id: BYPASS, risky: true }];

const COMPACT = "/compact";

export const PICTURES_MOST = 20;
export const CLIPS_MOST = 50;
export const STAGE_CAP = 20 * 1024 * 1024;
export const LONG_PASTE = { characters: 2500, lines: 40 };
const PASTED_TEXT = "pasted-text.txt";
const TOLD_KEPT = 50;

// A file attached from the project (or from outside it), and a picture pasted
// or dropped, as the message will carry them.
export interface File {
  path: string;
  name: string;
  bytes: number;
  outside: boolean;
  kind?: "file" | "folder" | "text";
  entries?: number;
  text?: string;
}

export interface Picture extends Partial<Pick<Fitted, "width" | "height" | "was">> {
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
const workingIn = (work: string) => panes.getState().open.filter((one) => workOf(one) === work);

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

export const writeMessage = (text: string, pane: Pane = focused()) => pane.desk.setState({ text });

export function toggleIsolate(pane: Pane = focused()) {
  const isolate = !pane.desk.getState().isolate;
  store(ISOLATE, isolate);
  pane.desk.setState({ isolate });
}

export function addToMessage(addition: string, pane: Pane = focused()) {
  const kept = pane.desk.getState().text.trimEnd();
  writeMessage(kept ? `${kept}\n\n${addition}` : addition, pane);
  warm(pane);
  requestAnimationFrame(() => {
    const field = document.getElementById("task");
    if (!(field instanceof HTMLTextAreaElement)) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  });
}

const MEGABYTES = STAGE_CAP / 1024 / 1024;

const refusal = ({ name, why }: Refused) =>
  ({ missing: t.missing, unreadable: t.unreadable, project: t.isProject, tooBig: (named: string) => t.tooBig(named, MEGABYTES) })[why](name);

const asFile = (item: AttachedFile, kind: File["kind"] = "file"): File => ({ path: item.path, name: item.name, bytes: item.bytes, outside: item.outside, kind });

const pictureOf = (name: string, fitted: Fitted): Picture => ({ name, ...fitted });

function blobOf(data: string, mediaType: string) {
  const raw = atob(data);
  const bytes = new Uint8Array(raw.length);
  for (let at = 0; at < raw.length; at++) bytes[at] = raw.charCodeAt(at);
  return new Blob([bytes], { type: mediaType });
}

function keep(taken: (File | Picture)[], pane: Pane) {
  const { attached, pasted } = pane.desk.getState();
  const files = [...attached];
  const pictures = [...pasted];
  let over = { pictures: false, files: false };
  for (const one of taken) {
    if ("url" in one) {
      if (pictures.length < PICTURES_MOST) pictures.push(one);
      else over = { ...over, pictures: true };
    } else if (files.some((file) => file.path === one.path)) continue;
    else if (files.length < CLIPS_MOST) files.push(one);
    else over = { ...over, files: true };
  }
  pane.desk.setState({ attached: files, pasted: pictures });
  if (over.pictures) warn(t.tooManyPictures(PICTURES_MOST), pane);
  if (over.files) warn(t.tooManyFiles(CLIPS_MOST), pane);
}

export async function attachPaths(paths: string[], pane: Pane = focused()) {
  const root = workOf(pane);
  if (!root || !paths.length) return;
  let found;
  try {
    found = await commands.attach(root, paths);
  } catch (reason) {
    return warn(String(reason), pane);
  }
  for (const refused of found.refused) warn(refusal(refused), pane);
  const taken: (File | Picture)[] = [];
  for (const item of found.items) {
    if (item.kind === "folder") taken.push({ path: item.path, name: item.name, bytes: 0, outside: item.outside, kind: "folder", entries: item.entries });
    else if (item.kind === "file") taken.push(asFile(item));
    else {
      const fitted = await fitPicture(blobOf(item.data, item.mediaType));
      if (fitted) taken.push(pictureOf(item.name, fitted));
      else if (item.outside && item.bytes > STAGE_CAP) warn(t.tooBig(item.name, MEGABYTES), pane);
      else taken.push(asFile({ ...item, kind: "file" }));
    }
  }
  keep(taken, pane);
}

async function stage(blob: Blob, name: string, pane: Pane) {
  if (blob.size > STAGE_CAP) {
    warn(t.tooBig(name, MEGABYTES), pane);
    return null;
  }
  try {
    const data = await readAsUrl(blob);
    return asFile(await commands.stageFile(name, data.slice(data.indexOf(",") + 1)));
  } catch (reason) {
    warn(t.stageFailed(name, reason instanceof Error ? reason.message : String(reason)), pane);
    return null;
  }
}

export async function takeFiles(files: globalThis.File[], pane: Pane = focused()) {
  const taken: (File | Picture)[] = [];
  for (const file of files) {
    const picture = file.type.startsWith("image/");
    const name = file.name || (picture ? t.pastedPicture : t.pastedFile);
    const fitted = picture && file.size <= RAW_PICTURE_CAP ? await fitPicture(file) : null;
    const one = fitted ? pictureOf(name, fitted) : await stage(file, name, pane);
    if (one) taken.push(one);
  }
  keep(taken, pane);
}

export const tooLong = (text: string) => text.length > LONG_PASTE.characters || text.split("\n").length > LONG_PASTE.lines;

export async function pasteText(text: string, pane: Pane = focused()) {
  const staged = await stage(new Blob([text], { type: "text/plain" }), PASTED_TEXT, pane);
  if (staged) keep([{ ...staged, kind: "text", text }], pane);
}

export function inlineText(file: File, pane: Pane = focused()) {
  const kept = pane.desk.getState().text.trimEnd();
  const text = file.text ?? "";
  dropFile(file.path, pane);
  writeMessage(kept ? `${kept}\n\n${text}` : text, pane);
}

const told = new Map<string, string>();

export const toldText = (path: string) => told.get(path);

function remember(files: File[]) {
  for (const file of files) if (file.text !== undefined) told.set(file.path, file.text);
  for (const path of told.keys()) if (told.size > TOLD_KEPT) told.delete(path);
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
  const work = workOf(pane);
  const mine = nextRepoLap(pane);
  const repo = work ? await commands.repo(work) : null;
  if (workOf(pane) === work && repoLaps.get(pane) === mine) pane.desk.setState({ repo });
}

// A branch switched: the agent's marks go, and what shows files reads them again.
export async function switchTo(name: string, pane: Pane = focused()) {
  const root = workOf(pane);
  let repo;
  try {
    repo = await commands.checkout(root, name);
  } catch (reason) {
    return warn(String(reason), pane);
  }
  for (const one of workingIn(root)) {
    nextRepoLap(one);
    one.desk.setState({ repo });
  }
  notice([t.branchSwitched, { bold: repo.branch }], "", pane);
  if (root !== project.getState().work) return;
  forgetEdits();
  forgetChanges();
  await loadFiles();
  const { opened } = viewer.getState();
  if (opened) await openFile(opened);
}

// A message goes when there is a project, a model and something to say.
export function canSend(text: string, pane: Pane = focused()) {
  const { root, choice, pasted, attached } = pane.desk.getState();
  return Boolean(root && choice.provider && (text.trim() || pasted.length || attached.length));
}

export async function send(text: string, pane: Pane = focused()) {
  if (pane.chat.getState().busy || !canSend(text, pane)) return;
  const { attached, pasted } = pane.desk.getState();
  const files = attached.map((file) => file.path);
  const message = {
    text: text.trim(),
    files,
    images: pasted.map((picture) => ({ mediaType: picture.mediaType, data: picture.url.slice(picture.url.indexOf(",") + 1) })),
  };
  remember(attached);
  forgetClips(pane);
  await sendChat({ message, shownFiles: files, pictures: pasted.map((picture) => picture.url) }, currentSettings(pane), pane);
}

export async function compactNow(pane: Pane = focused()) {
  if (pane.chat.getState().busy || !pane.desk.getState().session) return;
  await sendChat({ message: { text: COMPACT, files: [], images: [] }, shownFiles: [], pictures: [] }, currentSettings(pane), pane);
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
