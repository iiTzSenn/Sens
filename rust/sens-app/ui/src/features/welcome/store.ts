import { open } from "@tauri-apps/plugin-dialog";
import { createStore } from "zustand/vanilla";
import { draft } from "../../app/session";
import { commands, events } from "../../ipc/commands";
import type { Adopted, Found, FoundProject, Imported } from "../../ipc/types";
import { plural } from "../../shared/format.js";
import { loadProfile, profile, saveProfileName } from "../profile/store";
import { loadRail, rail } from "../rail/store";
import { loadProviders } from "../settings/store";

export type Step = "hello" | "name" | "claude" | "import" | "project" | "ready";

export const STEPS: Step[] = ["hello", "name", "claude", "import", "project", "ready"];

export type Mood = "work" | "done" | "warn";

export interface Line {
  id: string;
  said: string;
  mood: Mood;
  detail?: string;
}

export interface Place {
  root: string;
  name: string;
  last: number;
}

declare global {
  interface Window {
    __SENS_WELCOMED__?: boolean;
  }
}

export const welcome = createStore(() => ({
  open: false,
  still: false,
  step: "hello" as Step,
  name: "",
  found: null as Found | null,
  scanning: false,
  fault: "",
  roots: new Set<string>(),
  servers: new Set<string>(),
  first: "",
  picked: null as Place | null,
  lines: [] as Line[],
  applying: false,
  finished: false,
  adopted: null as Adopted | null,
  imported: null as Imported | null,
}));

const set = welcome.setState;

const importable = (project: FoundProject) => project.exists && project.sessions > 0;

export function greetAtStart() {
  if (window.__SENS_WELCOMED__ !== false) return;
  openWelcome();
  set({ still: true });
}

export function greetIfNew() {
  if (profile.getState().person.welcomed !== false) return;
  const { open, name } = welcome.getState();
  if (!open) return openWelcome();
  if (!name) set({ name: profile.getState().person.name });
}

export function openWelcome(step: Step = "hello") {
  set({
    open: true,
    still: false,
    step,
    name: profile.getState().person.name,
    finished: false,
    applying: false,
    lines: [],
    adopted: null,
    imported: null,
  });
  if (step === "import") scan();
}

export function goTo(step: Step) {
  set({ step });
  if (step === "claude") loadProviders();
  if (step === "import" && !welcome.getState().found && !welcome.getState().scanning) scan();
  if (step === "project") settleFirst();
  if (step === "ready") apply();
}

export const next = () => goTo(STEPS[STEPS.indexOf(welcome.getState().step) + 1] ?? "ready");

export const setName = (name: string) => set({ name });

export async function scan() {
  set({ scanning: true, fault: "" });
  try {
    const found = await commands.welcomeScan();
    const roots = new Set(found.projects.filter((one) => importable(one) && one.suggested).map((one) => one.root));
    const servers = new Set(found.foreign.filter((one) => !one.blocked).map((one) => one.id));
    set({ found, roots, servers });
  } catch (reason) {
    set({ fault: String(reason) });
  }
  set({ scanning: false });
}

const toggled = (chosen: Set<string>, id: string, on: boolean) => {
  const made = new Set(chosen);
  if (on) made.add(id);
  else made.delete(id);
  return made;
};

export const chooseRoot = (root: string, on: boolean) => set(({ roots }) => ({ roots: toggled(roots, root, on) }));

export const chooseServer = (id: string, on: boolean) => set(({ servers }) => ({ servers: toggled(servers, id, on) }));

export function chooseAllRoots(on: boolean) {
  const found = welcome.getState().found;
  set({ roots: new Set(on ? (found?.projects ?? []).filter(importable).map((one) => one.root) : []) });
}

export function places(): Place[] {
  const { found, roots, picked } = welcome.getState();
  const known = (rail.getState().spaces ?? []).map((one) => ({ root: one.root, name: one.name, last: one.activeAt }));
  const brought = (found?.projects ?? []).filter((one) => roots.has(one.root)).map((one) => ({ root: one.root, name: one.name, last: one.last }));
  const seen = new Set<string>();
  const all = [...(picked ? [picked] : []), ...[...brought, ...known].sort((a, b) => b.last - a.last)];
  return all.filter((one) => !seen.has(one.root) && seen.add(one.root)).slice(0, 5);
}

function settleFirst() {
  const listed = places();
  if (!listed.some((one) => one.root === welcome.getState().first)) set({ first: listed[0]?.root ?? "" });
}

export const chooseFirst = (root: string) => set({ first: root });

export async function pickFolder() {
  const picked = await open({ directory: true, title: "Elige la carpeta del proyecto" });
  if (typeof picked !== "string") return;
  const name = picked.split(/[\\/]/).filter(Boolean).pop() ?? picked;
  set({ picked: { root: picked, name, last: Date.now() }, first: picked });
}

function note(line: Line) {
  set(({ lines }) => {
    const at = lines.findIndex((one) => one.id === line.id);
    if (at < 0) return { lines: [...lines, line] };
    const made = [...lines];
    made[at] = line;
    return { lines: made };
  });
}

async function step(id: string, working: string, work: () => Promise<Line | null>) {
  note({ id, said: working, mood: "work" });
  try {
    const done = await work();
    if (done) note(done);
    else set(({ lines }) => ({ lines: lines.filter((one) => one.id !== id) }));
  } catch (reason) {
    note({ id, said: working.replace(/…$/, ""), mood: "warn", detail: String(reason) });
  }
}

const detailOf = <T extends { reason: string }>(skipped: T[], label: (one: T) => string) =>
  skipped.map((one) => `${label(one)}: ${one.reason}`).join("\n");

async function apply() {
  const state = welcome.getState();
  if (state.applying || state.finished) return;
  set({ applying: true, lines: [] });
  const roots = [...state.roots];
  const servers = [...state.servers];

  await step("name", "Guardando tu nombre…", async () => {
    const name = state.name.trim();
    if (name === profile.getState().person.name.trim()) return null;
    await saveProfileName(name);
    return { id: "name", said: name ? `Nombre guardado · ${name}` : "Sin nombre", mood: "done" };
  });

  if (roots.length) {
    const stop = await events.welcome((done, total) => note({ id: "sessions", said: `Importando sesiones · ${done} de ${total}`, mood: "work" }));
    await step("sessions", "Importando sesiones…", async () => {
      const adopted = await commands.welcomeAdopt(roots);
      set({ adopted });
      const said = `${plural(adopted.sessions, "sesión importada", "sesiones importadas")} en ${plural(adopted.projects, "proyecto", "proyectos")}`;
      if (!adopted.skipped.length) return { id: "sessions", said, mood: "done" };
      return { id: "sessions", said, mood: "warn", detail: detailOf(adopted.skipped, (one) => one.root) };
    });
    stop();
  }

  if (servers.length) {
    await step("servers", "Añadiendo servidores MCP…", async () => {
      const where = [...new Set([...roots, state.first].filter(Boolean))];
      const imported = await commands.welcomeServers(servers, where);
      set({ imported });
      const said = `${plural(imported.added.length, "servidor MCP añadido", "servidores MCP añadidos")}`;
      if (!imported.skipped.length) return { id: "servers", said, mood: "done" };
      return { id: "servers", said, mood: "warn", detail: detailOf(imported.skipped, (one) => one.name) };
    });
  }

  await commands.setWelcomed(true).catch(() => {});
  await Promise.all([loadProfile(), loadRail()]);
  set({ applying: false, finished: true });
}

export async function skip() {
  await commands.setWelcomed(true).catch(() => {});
  await loadProfile();
  set({ open: false });
}

export async function enter() {
  const { first } = welcome.getState();
  set({ open: false });
  if (first) await draft(first);
}
