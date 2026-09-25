import { open } from "@tauri-apps/plugin-dialog";
import { createStore } from "zustand/vanilla";
import { languageNow, showLanguage, type Language } from "../shared/i18n";
import { FIRST_LOOK, lookOf, showLook, type Look } from "../shared/look";
import { t } from "./copy";
import { heard, setup, type Place, type Progress, type SetupState, type Step, type Stopped } from "./ipc";

export type Screen = "language" | "welcome" | "custom" | "look" | "busy" | "running" | "done" | "error";

export type Closing = "" | "closing" | "forcing" | "stillOpen";

const STEP_AT_LEAST = 280;
const FORCE_AFTER = 10_000;
const UPDATE_PAUSE = 900;

export const installer = createStore(() => ({
  info: null as SetupState | null,
  screen: "welcome" as Screen,
  before: "welcome" as Screen,
  spoke: false,
  look: FIRST_LOOK,
  dir: "",
  desktop: true,
  startMenu: true,
  place: null as Place | null,
  placeFault: "",
  removeData: false,
  working: false,
  cancelling: false,
  progress: 0,
  step: "check" as Step,
  lines: [] as string[],
  details: false,
  closing: "" as Closing,
  closeFault: "",
  force: false,
  fault: "",
  opening: false,
  openFault: "",
}));

const set = installer.setState;
const sleep = (millis: number) => new Promise((done) => setTimeout(done, millis));
const info = () => installer.getState().info!;
const queue: Progress[] = [];
let draining = false;
let shownAt = 0;
let forceTimer = 0;

export const uninstalling = () => info().mode === "uninstall";
export const unattended = () => info().mode === "update" || info().passive;
export const choosing = () => info().mode === "install" && !info().installed && !unattended();
export const speaking = () => !uninstalling() && !unattended();

export function compare(a: string, b: string) {
  const parts = (version: string) => version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let at = 0; at < 3; at++) {
    if ((left[at] ?? 0) !== (right[at] ?? 0)) return (left[at] ?? 0) - (right[at] ?? 0);
  }
  return 0;
}

export const stoppedOf = (reason: unknown): Stopped =>
  typeof reason === "object" && reason !== null && "cancelled" in reason
    ? { cancelled: Boolean((reason as Stopped).cancelled), reason: String((reason as Stopped).reason ?? "") }
    : { cancelled: false, reason: String(reason) };

export function titleNow() {
  document.title = installer.getState().info?.mode === "uninstall" ? t.uninstallPage : t.install;
}

function present(progress: Progress) {
  set(({ screen, lines }) => ({
    screen: screen === "running" ? "busy" : screen,
    progress: progress.progress,
    step: progress.step,
    lines: progress.line ? [...lines, progress.line] : lines,
  }));
}

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const next = queue.shift()!;
    const wait = STEP_AT_LEAST - (performance.now() - shownAt);
    if (wait > 0) await sleep(wait);
    present(next);
    shownAt = performance.now();
  }
  draining = false;
}

async function settled() {
  while (draining || queue.length) await sleep(40);
  await sleep(STEP_AT_LEAST);
}

function running() {
  clearTimeout(forceTimer);
  set({ screen: "running", closing: "", closeFault: "", force: false });
  forceTimer = window.setTimeout(() => set({ force: true }), FORCE_AFTER);
}

export async function boot() {
  try {
    await heard.progress((progress) => {
      queue.push(progress);
      drain();
    });
    await heard.running(running);
    const state = await setup.state();
    const look = lookOf(state.look ?? FIRST_LOOK);
    set({ info: state, dir: state.dir, desktop: state.installed ? state.desktop : true, look });
    showLook(look);
    titleNow();
    setup.language(languageNow()).catch(() => {});
    if (choosing()) set({ screen: "language", before: "welcome", spoke: true });
  } catch (reason) {
    set({ screen: "error", fault: String(reason) });
    return;
  }
  if (unattended()) run();
}

export async function checkDir() {
  const { dir } = installer.getState();
  try {
    const place = await setup.dir(dir);
    set({ place, placeFault: place.problem });
  } catch (reason) {
    set({ place: null, placeFault: String(reason) });
  }
}

export function customize() {
  set({ screen: "custom" });
  checkDir();
}

export const back = () => set({ screen: "welcome" });

export const toLook = () => set(({ screen }) => ({ screen: "look", before: screen }));

export const leaveLook = () => set(({ before }) => ({ screen: before }));

export const toLanguage = () => set(({ screen }) => ({ screen: "language", before: screen, spoke: true }));

export function leaveLanguage() {
  const { before } = installer.getState();
  set({ screen: before });
  if (before === "custom") checkDir();
}

export function chooseLanguage(chosen: Language) {
  showLanguage(chosen);
  titleNow();
  setup.language(chosen).catch(() => {});
}

export function chooseLook(look: Look) {
  set({ look });
  showLook(look);
}

export async function pickDir() {
  const picked = await open({ directory: true, title: t.pickDir, defaultPath: installer.getState().dir });
  if (typeof picked !== "string") return;
  const named = picked.replace(/[\\/]+$/, "");
  set({ dir: /[\\/]sens$/i.test(named) ? named : `${named}\\Sens` });
  await checkDir();
}

export async function run() {
  const { working, dir, desktop, startMenu, removeData, look, spoke } = installer.getState();
  if (working) return;
  queue.length = 0;
  set({ working: true, cancelling: false, progress: 0, lines: [], step: "check", screen: "busy" });
  try {
    if (uninstalling()) await setup.uninstall(removeData);
    else await setup.install({ dir, desktop, startMenu, look: choosing() ? look : null, language: speaking() && spoke ? languageNow() : null });
    await settled();
    await finish();
  } catch (reason) {
    await settled();
    await stopped(stoppedOf(reason));
  } finally {
    clearTimeout(forceTimer);
    set({ working: false });
  }
}

async function stopped({ cancelled, reason }: Stopped) {
  if (!cancelled) return set({ screen: "error", fault: reason.charAt(0).toUpperCase() + reason.slice(1) });
  if (unattended()) return setup.quit();
  set({ screen: "welcome" });
}

async function finish() {
  set({ progress: 1, screen: "done" });
  if (uninstalling() || !unattended()) return;
  await sleep(UPDATE_PAUSE);
  if (info().relaunch) {
    set({ opening: true });
    await setup.launch();
  }
  await setup.quit();
}

export async function closeApp(force: boolean) {
  set({ closing: force ? "forcing" : "closing", closeFault: "" });
  try {
    const gone = await setup.closeApp(force);
    set(gone ? { closing: "" } : { closing: "stillOpen", force: true });
  } catch (reason) {
    set({ closing: "", closeFault: String(reason), force: true });
  }
}

export async function cancel() {
  set({ cancelling: true });
  await setup.cancel();
}

export async function quit() {
  if (installer.getState().working) return cancel();
  await setup.quit();
}

export async function openSens() {
  set({ opening: true, openFault: "" });
  try {
    await setup.launch();
  } catch (reason) {
    set({ opening: false, openFault: String(reason) });
    return;
  }
  await setup.quit();
}

export const toggleDetails = () => set(({ details }) => ({ details: !details }));
