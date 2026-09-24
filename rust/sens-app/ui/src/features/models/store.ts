import { createStore } from "zustand/vanilla";
import { commands } from "../../ipc/commands";
import type { Account, Card, Provider } from "../../ipc/types";
import { API_KEY_SOURCE, PLANS, keyed } from "../../shared/account";
import { store, stored } from "../../shared/storage.js";
import { CHOICE, focused, panes, type Pane } from "../panes/store";

const KNOWN = "sens.models.v4";
const HIDDEN = "sens.models.hidden";
const ASKED = "sens.models.asked";

// The providers Sens chats through and the models each offers (kept across
// launches, asked for again once a day), the ones hidden from the picker, the
// one chosen, and what the account says: its billing, its usage, or why it
// could not be read.
export const models = createStore(() => ({
  catalog: [] as Provider[],
  known: stored(KNOWN, {}) as Record<string, Card[]>,
  hidden: new Set<string>([].concat(stored(HIDDEN, []))),
  fetching: false,
  note: "",
  account: null as Account | null,
  accountFault: "",
  usage: null as Record<string, { utilization?: number }> | null,
  behind: "",
}));

const set = models.setState;

const MODEL_SAID: Record<string, string> = {
  "Best for everyday, complex tasks": "El mejor para el trabajo complejo de cada día",
  "Most capable for your hardest and longest-running tasks": "El más capaz para las tareas más difíciles y largas",
  "Efficient for routine tasks": "Eficiente para tareas rutinarias",
  "Fastest for quick answers": "El más rápido para respuestas cortas",
};

export function saidOf(card: Card) {
  const tagline = card.description.split(" · ").pop()!;
  return MODEL_SAID[tagline] || tagline;
}

const claudeCodeAbsent = (reason: unknown) => String(reason).startsWith("no encuentro Claude Code");

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// "claude-opus-5-5" reads "Opus 5.5" when the catalog does not name it.
function prettyModel(id: string) {
  const [family, ...rest] = id.replace(/^claude-/, "").replace(/\[.*$/, "").split("-");
  const version = [];
  for (const part of rest) {
    if (!/^\d{1,7}$/.test(part)) break;
    version.push(part);
  }
  return [capital(family), version.join(".")].filter(Boolean).join(" ");
}

export const modelsOf = (provider: Provider) => models.getState().known[provider.id] || [];
export const offeredBy = (provider: Provider) => modelsOf(provider).filter((card) => !models.getState().hidden.has(card.id));

export function modelName(id: string) {
  if (!id) return "Claude";
  const card = models.getState().catalog.flatMap(modelsOf).find((one) => one.id === id);
  return card ? card.label : prettyModel(id);
}

export function chosenCard(pane: Pane = focused()) {
  const { known } = models.getState();
  const { choice } = pane.desk.getState();
  return (known[choice.provider] || []).find((card) => card.id === choice.model);
}

// The choice kept if it is still offered, else the first model offered.
export function settle(pane: Pane, wanted = pane.desk.getState().choice) {
  const { catalog } = models.getState();
  const offered = catalog.flatMap((provider) => offeredBy(provider).map((card) => ({ provider, card })));
  const kept = offered.find(({ provider, card }) => provider.id === wanted.provider && card.id === wanted.model) || offered[0];
  const provider = kept ? kept.provider : catalog[0];
  if (!provider) return;
  const choice = { provider: provider.id, model: kept ? kept.card.id : "" };
  if (pane === focused()) store(CHOICE, choice);
  pane.desk.setState({ choice });
}

const settleAll = () => panes.getState().open.forEach((pane) => settle(pane));

export const choose = (provider: string, model: string, pane: Pane = focused()) => settle(pane, { provider, model });

export function toggleHidden(id: string) {
  set(({ hidden }) => {
    const next = new Set(hidden);
    if (!next.delete(id)) next.add(id);
    store(HIDDEN, [...next]);
    return { hidden: next };
  });
  settleAll();
}

// What the chosen model is called in the picker: the model, or its provider
// while there is none.
export function chosenLabel(pane: Pane = focused()) {
  const card = chosenCard(pane);
  if (card) return card.label;
  const { catalog } = models.getState();
  const { choice } = pane.desk.getState();
  return catalog.find((provider) => provider.id === choice.provider)?.label || "modelo";
}

export async function refreshModels() {
  if (models.getState().fetching) return;
  set({ fetching: true, note: "" });
  store(ASKED, new Date().toDateString());
  const known = { ...models.getState().known };
  const failures: string[] = [];
  for (const provider of models.getState().catalog) {
    try {
      known[provider.id] = await commands.models(provider.id);
    } catch (reason) {
      if (!claudeCodeAbsent(reason)) failures.push(`${provider.label}: ${reason}`);
    }
  }
  store(KNOWN, known);
  set({ known, fetching: false, note: failures.join(" · ") });
  settleAll();
}

// A provider without models, or a day without asking, asks again.
export function refreshWhenDue() {
  const missing = models.getState().catalog.some((provider) => !modelsOf(provider).length);
  const stale = stored(ASKED, "") !== new Date().toDateString();
  if (missing || stale) refreshModels();
}

export async function loadCatalog() {
  const catalog = await commands.providers();
  set({ catalog });
  if (!catalog.length) return;
  settleAll();
  refreshWhenDue();
  readAccount();
  checkClaudeCode();
}

export async function checkClaudeCode() {
  try {
    set({ behind: (await commands.claudeCodeNewer()) || "" });
  } catch {
    set({ behind: "" });
  }
}

export async function readAccount() {
  try {
    set({ account: await commands.claudeAccount(), accountFault: "" });
  } catch (reason) {
    set({ account: null, accountFault: claudeCodeAbsent(reason) ? "Falta Claude Code" : String(reason) });
  }
  return models.getState().account;
}

export const noteLimits = (usage: Record<string, { utilization?: number }>) => set({ usage });

const BILLED: Record<Account["billing"], (account: Account) => string[]> = {
  subscription: ({ plan, source, email }) => [`Suscripción ${PLANS[plan] || plan}`.trim(), source, email],
  noPlan: ({ email }) => [email, "sin plan Pro ni Max"],
  elsewhere: ({ source }) => [source === API_KEY_SOURCE ? "Clave de API de la Consola" : `Claude Code usa ${source}, no tu suscripción`],
  signedOut: () => ["Claude Code no tiene sesión"],
};

// The account under the models: how it pays, and how much of the five-hour
// window a subscription used. `warn` when Claude Code is not paying with it.
export function accountLine() {
  const { account, accountFault, usage } = models.getState();
  const said = accountFault ? [accountFault] : account ? BILLED[account.billing](account) : [];
  const window = usage?.five_hour;
  if (account?.billing === "subscription" && typeof window?.utilization === "number") said.push(`${Math.round(window.utilization * 100)} % usado en 5 h`);
  return {
    text: said.filter(Boolean).join(" · "),
    warn: Boolean(accountFault) || (account?.billing !== "subscription" && !keyed(account)),
  };
}

// Signing in is offered while it is being done, or when the account cannot chat.
export const signInWanted = () => {
  const { account, accountFault } = models.getState();
  return Boolean(accountFault) || ["signedOut", "noPlan"].includes(account?.billing ?? "");
};
