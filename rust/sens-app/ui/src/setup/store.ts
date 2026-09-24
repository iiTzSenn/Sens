import { open } from "@tauri-apps/plugin-dialog";
import { createStore } from "zustand/vanilla";
import { heard, setup, type Place, type Progress, type SetupState, type Step } from "./ipc";

export type Screen = "welcome" | "custom" | "busy" | "running" | "done" | "error";

const STEP_AT_LEAST = 280;
const FORCE_AFTER = 10_000;
const UPDATE_PAUSE = 900;

export const STEPS: Record<Step, string> = {
  check: "Comprobando…",
  close: "Esperando a que Sens se cierre…",
  extract: "Copiando archivos…",
  swap: "Colocando la versión nueva…",
  register: "Registrando Sens en Windows…",
  shortcuts: "Creando accesos…",
  done: "Listo.",
  remove: "Quitando Sens…",
};

export const installer = createStore(() => ({
  info: null as SetupState | null,
  screen: "welcome" as Screen,
  dir: "",
  desktop: true,
  startMenu: true,
  place: null as Place | null,
  placeFault: "",
  removeData: false,
  working: false,
  cancelling: false,
  progress: 0,
  status: STEPS.check,
  lines: [] as string[],
  details: false,
  closing: "",
  force: false,
  fault: "",
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

export function compare(a: string, b: string) {
  const parts = (version: string) => version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let at = 0; at < 3; at++) {
    if ((left[at] ?? 0) !== (right[at] ?? 0)) return (left[at] ?? 0) - (right[at] ?? 0);
  }
  return 0;
}

function present(progress: Progress) {
  set(({ screen, lines }) => ({
    screen: screen === "running" ? "busy" : screen,
    progress: progress.progress,
    status: STEPS[progress.step] ?? progress.line,
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
  set({ screen: "running", closing: "", force: false });
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
    set({ info: state, dir: state.dir, desktop: state.installed ? state.desktop : true });
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

export async function pickDir() {
  const picked = await open({ directory: true, title: "Elige dónde instalar Sens", defaultPath: installer.getState().dir });
  if (typeof picked !== "string") return;
  const named = picked.replace(/[\\/]+$/, "");
  set({ dir: /[\\/]sens$/i.test(named) ? named : `${named}\\Sens` });
  await checkDir();
}

export async function run() {
  const { working, dir, desktop, startMenu, removeData } = installer.getState();
  if (working) return;
  queue.length = 0;
  set({ working: true, cancelling: false, progress: 0, lines: [], status: STEPS.check, screen: "busy" });
  try {
    if (uninstalling()) await setup.uninstall(removeData);
    else await setup.install({ dir, desktop, startMenu });
    await settled();
    await finish();
  } catch (reason) {
    await settled();
    await stopped(String(reason));
  } finally {
    clearTimeout(forceTimer);
    set({ working: false });
  }
}

async function stopped(reason: string) {
  if (reason !== "cancelado") return set({ screen: "error", fault: reason.charAt(0).toUpperCase() + reason.slice(1) });
  if (unattended()) return setup.quit();
  set({ screen: "welcome" });
}

async function finish() {
  set({ progress: 1, screen: "done" });
  if (uninstalling() || !unattended()) return;
  await sleep(UPDATE_PAUSE);
  if (info().relaunch) await setup.launch();
  await setup.quit();
}

export async function closeApp(force: boolean) {
  set({ closing: force ? "Forzando el cierre…" : "Cerrando Sens…" });
  try {
    const gone = await setup.closeApp(force);
    set(gone ? { closing: "" } : { closing: "Sens no se ha cerrado todavía.", force: true });
  } catch (reason) {
    set({ closing: String(reason), force: true });
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
  await setup.launch();
  await setup.quit();
}

export const toggleDetails = () => set(({ details }) => ({ details: !details }));
