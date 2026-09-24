import { createStore } from "zustand/vanilla";
import { commands, events } from "../../ipc/commands";
import type { ClaudeCodeProgress, Method, ProviderState } from "../../ipc/types";
import { readAccount, refreshModels } from "../models/store";
import { store, stored } from "../../shared/storage.js";

export type Section = "general" | "providers";

const SECTION = "sens.settings.section";
const SECTIONS: Section[] = ["general", "providers"];
const kept = stored(SECTION, "");

// `visits` counts every time the view opens, so the pane starts fresh each
// time. `connecting` is read by the model picker too, while a sign-in runs.
export const settings = createStore(() => ({
  section: (SECTIONS.includes(kept) ? kept : "general") as Section,
  visits: 0,
  providers: null as ProviderState[] | null,
  fault: "",
  choosing: {} as Partial<Record<string, Method>>,
  faults: {} as Partial<Record<string, string>>,
  progress: null as ClaudeCodeProgress | null,
  connecting: false,
}));

const without = <T>(map: Partial<Record<string, T>>, id: string) => {
  const { [id]: _dropped, ...rest } = map;
  return rest;
};

const failing = (id: string, reason: unknown) =>
  settings.setState(({ faults }) => ({ faults: { ...faults, [id]: String(reason) } }));

export function showSection(section: Section) {
  store(SECTION, section);
  settings.setState({ section });
}

export function enterSettings() {
  settings.setState(({ visits }) => ({ visits: visits + 1 }));
  if (settings.getState().section === "providers") loadProviders();
}

export async function loadProviders() {
  try {
    settings.setState({ providers: await commands.providersState(), fault: "" });
  } catch (reason) {
    settings.setState({ fault: String(reason) });
  }
}

async function afterProviderChange() {
  await loadProviders();
  await readAccount();
  refreshModels();
}

async function act(state: ProviderState, work: () => Promise<unknown>) {
  settings.setState(({ faults }) => ({ faults: without(faults, state.id) }));
  try {
    await work();
    settings.setState(({ choosing }) => ({ choosing: without(choosing, state.id) }));
  } catch (reason) {
    failing(state.id, reason);
  }
  await afterProviderChange();
  return !settings.getState().faults[state.id];
}

async function installClaudeCode() {
  settings.setState({ progress: { stage: "downloading", done: 0, total: 0 } });
  try {
    await commands.claudeCodeInstall();
  } finally {
    settings.setState({ progress: null });
  }
}

export const install = (state: ProviderState) => act(state, installClaudeCode);
export const recheck = (state: ProviderState) => act(state, async () => {});
export const signOut = (state: ProviderState) => act(state, commands.providerSignOut);
export const forgetKey = (state: ProviderState) => act(state, () => commands.forgetApiKey(state.id));

export async function saveKey(state: ProviderState, key: string) {
  const saved = await act(state, () => commands.saveApiKey(state.id, key));
  if (saved && !state.installed) await install(state);
}

export async function pickMethod(state: ProviderState, method: Method) {
  settings.setState(({ choosing, faults }) => ({
    choosing: { ...choosing, [state.id]: method },
    faults: without(faults, state.id),
  }));
  if (method === "apiKey" && !state.keyHint) return;
  await act(state, () => commands.setProviderMethod(state.id, method));
}

export async function signIn(state: ProviderState, method: Method) {
  if (settings.getState().connecting) return;
  if (!state.installed && !(await install(state))) return;
  settings.setState(({ faults }) => ({ connecting: true, faults: without(faults, state.id) }));
  try {
    await commands.providerSignIn(method);
  } catch (reason) {
    failing(state.id, reason);
  }
  settings.setState({ connecting: false });
  await afterProviderChange();
}

events.claudeCode((progress) => {
  if (settings.getState().progress) settings.setState({ progress });
});
