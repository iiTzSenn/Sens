import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as dialog from "@tauri-apps/plugin-dialog";
import { loadShelf } from "../features/artifacts/store";
import { enterCapabilities } from "../features/capabilities/store";
import { forgetChanges, loadChanges } from "../features/changes/store";
import { plain } from "../features/market/search.js";
import { loadProfile } from "../features/profile/store";
import { forgetTree, loadFiles } from "../features/files/store";
import { forgetViewer, openFile, viewer } from "../features/files/view";
import { forgetEdits, project } from "../features/project/store";
import { failRail, fold, loadRail, oweRail } from "../features/rail/store";
import { blank, chat, halt, hello, idle, load, notice, send as sendChat, warm as warmChat, warn } from "../features/chat/store";
import { openUpdate } from "../features/updates/UpdatePanel";
import { enterSite, forgetSite, syncBrowser } from "../features/web/store";
import { enterSettings, settings, showSection } from "../features/settings/store";
import { runningTasks, tasks, tickTasks } from "../features/tasks/store";
import { startUpdates, updates } from "../features/updates/store";
import { API_KEY_SOURCE, PLANS, keyed } from "../shared/account";
import { stem, weigh } from "../shared/format.js";
import { anchorMenu } from "../shared/anchorMenu";
import { ICONS } from "../shared/icons.js";
import { sheets } from "../shared/sheets.js";
import { store, stored } from "../shared/storage.js";
import { legacy } from "./bridge";

const frame = getCurrentWindow();

const body = document.getElementById("body");
const taskInput = document.getElementById("task");
const rootLabel = document.getElementById("root");
const folderBtn = document.getElementById("folder");
const codePanel = document.getElementById("code");
const toolBtn = document.getElementById("tools");
const toolMenu = document.getElementById("tool-menu");
const changesReload = document.getElementById("changes-reload");
const codeBody = document.getElementById("code-body");
const crewLabel = document.getElementById("crew");
const effortBox = document.getElementById("effort");
const effortBtn = document.getElementById("effort-pick");
const effortLabel = document.getElementById("effort-label");
const effortPanel = document.getElementById("effort-sheet");
const effortNowLabel = document.getElementById("effort-now");
const effortHelp = document.getElementById("effort-help");
const effortTrack = document.getElementById("effort-track");
const effortTicks = document.getElementById("effort-ticks");
const effortPixels = document.getElementById("effort-pixels");
const thinkBtn = document.getElementById("think");
const modeBtn = document.getElementById("mode-pick");
const modeLabel = document.getElementById("mode-label");
const modePanel = document.getElementById("mode-sheet");
const composerBox = document.querySelector(".composer .box");
const clipRow = document.getElementById("clips");
const sendBtn = document.getElementById("send");
const dictateBtn = document.getElementById("dictate");
const attachBtn = document.getElementById("attach");
const pickBtn = document.getElementById("pick");
const picker = document.getElementById("picker");
const branchBtn = document.getElementById("branch");
const branchLabel = document.getElementById("branch-name");
const branchDot = document.getElementById("dirty");
const branchPanel = document.getElementById("branches");
const branchHere = document.getElementById("branch-here");
const branchRows = document.getElementById("branch-rows");
const branchFilter = document.getElementById("branch-filter");
const chatSection = document.querySelector("section.chat");
const shelf = document.getElementById("shelf");
const capsView = document.getElementById("capabilities-view");
const settingsView = document.getElementById("settings-view");
const panel = document.getElementById("panel");
const panelTitle = document.getElementById("panel-title");
const panelBody = document.getElementById("panel-body");

let root = "";
let repo = null;

const el = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
};

let showing = "";

const panelShows = (name) => body.dataset.code === "open" && codePanel.dataset.tool === name;

function showTool(name) {
  codePanel.dataset.tool = name;
  for (const section of codePanel.querySelectorAll(":scope > .tool")) section.hidden = section.dataset.tool !== name;
  body.dataset.code = "open";
  TOOLS[name].enter?.();
  syncBrowser();
}

function closeTools() {
  body.dataset.code = "closed";
  syncBrowser();
}

const TOOLS = {
  files: { label: "Ficheros", said: "El árbol y el código del proyecto", icon: ICONS.files },
  changes: { label: "Cambios", said: "Lo que difiere del último commit", icon: ICONS.compare, enter: loadChanges, count: () => (repo?.dirty ? String(repo.dirty) : "") },
  web: { label: "Web", said: "Páginas y servidores locales", icon: ICONS.globe, enter: enterSite },
  tasks: { label: "Segundo plano", said: "Subagentes y comandos del modelo", icon: ICONS.activity, enter: tickTasks, count: () => (runningTasks() ? String(runningTasks()) : "") },
};

tasks.subscribe(() => {
  toolBtn.dataset.running = String(runningTasks() > 0);
});

function toolRow(name, tool) {
  const item = el("button", "menu-item");
  item.type = "button";
  item.tabIndex = -1;
  item.setAttribute("role", "menuitemradio");
  item.setAttribute("aria-checked", String(panelShows(name)));
  const glyph = el("span", "act-icon");
  glyph.innerHTML = tool.icon;
  const text = el("span", "mode-text");
  text.append(el("span", null, tool.label), el("span", "mode-sub", tool.said));
  item.append(glyph, text, el("span", "tool-count", tool.count?.() || ""));
  item.addEventListener("click", () => {
    toolSheet.shut();
    showTool(name);
  });
  return item;
}

function paintToolMenu() {
  toolMenu.replaceChildren(...Object.entries(TOOLS).map(([name, tool]) => toolRow(name, tool)));
  anchorMenu(toolMenu, toolBtn);
}

// The composer follows the chat: busy while Claude works, stopping while it stops.
function paintBusy() {
  const { busy, stopping } = chat.getState();
  composerBox.dataset.busy = String(busy);
  composerBox.dataset.stopping = String(stopping);
  taskInput.disabled = !root;
  syncSend();
}

chat.subscribe((now, before) => {
  if (now.busy === before.busy && now.stopping === before.stopping) return;
  if (now.busy && !before.busy) reseedLap();
  paintBusy();
});

const warm = () => warmChat(currentSettings());

async function enter(picked) {
  root = picked;
  project.setState({ root: picked, session: "" });
  rootLabel.textContent = stem(picked);
  folderBtn.title = picked;
  forgetEdits();
  attached = [];
  paintClips();
  forgetSite();
  forgetViewer();
  forgetTree();
  idle(true);
  paintBusy();
  if (showing) VIEWS[showing].load();
  await invoke("remember", { root: picked }).catch(oweRail);
  await readRepo();
  forgetChanges();
  await loadFiles();
}

async function visit(home, then) {
  toChat();
  try {
    if (home !== root) await enter(home);
    await then();
  } catch (reason) {
    failRail(reason);
  }
}

const draft = (home) => visit(home, async () => {
  fold(home, false);
  blank("");
  idle(true);
  hello();
  taskInput.focus();
  await loadRail();
});

const resume = (home, id) => visit(home, () => load(id));

async function chooseFolder() {
  const picked = await dialog.open({
    directory: true,
    title: "Elige la carpeta de trabajo",
    defaultPath: root || undefined,
  });
  if (picked) await draft(picked);
}

function fresh() {
  toChat();
  return root ? draft(root) : chooseFolder();
}

const VIEWS = {
  capabilities: { node: capsView, load: enterCapabilities },
  artifacts: { node: shelf, load: loadShelf },
  settings: { node: settingsView, load: enterSettings },
};

function showView(name) {
  showing = name;
  project.setState({ view: name });
  chatSection.hidden = Boolean(name);
  for (const [id, one] of Object.entries(VIEWS)) one.node.hidden = id !== name;
  if (name) VIEWS[name].load();
}

function toChat() {
  if (showing) showView("");
}

const RECALL = "sens.choice";

const KNOWN = "sens.models.v3";

const MODEL_SAID = {
  "Best for everyday, complex tasks": "El mejor para el trabajo complejo de cada día",
  "Most capable for your hardest and longest-running tasks": "El más capaz para las tareas más difíciles y largas",
  "Efficient for routine tasks": "Eficiente para tareas rutinarias",
  "Fastest for quick answers": "El más rápido para respuestas cortas",
};
const HIDDEN = "sens.models.hidden";
const ASKED = "sens.models.asked";
const EFFORT = "sens.effort";
const THINKING = "sens.thinking";
const MODE = "sens.mode";

const EFFORT_NAMES = { low: "Bajo", medium: "Medio", high: "Alto", xhigh: "Extra", max: "Max" };

const EFFORT_HELP =
  "Cuánto razona el modelo antes de responder. Más esfuerzo tarda más y gasta más, pero acierta más en lo difícil.";

const MODES = [
  { id: "default", label: "Preguntar", said: "Pide permiso antes de editar ficheros o ejecutar comandos." },
  { id: "acceptEdits", label: "Aceptar ediciones", said: "Edita sin preguntar; pide permiso para los comandos." },
  { id: "auto", label: "Automático", said: "Un clasificador aprueba o bloquea cada acción por ti." },
  { id: "plan", label: "Planificar", said: "Explora y propone un plan sin tocar nada." },
  { id: "bypassPermissions", label: "Sin control", said: "Lo hace todo sin pedir permiso: edita, ejecuta comandos y usa la red. Solo en proyectos de confianza.", risky: true },
];

let catalog = [];
let attached = [];
let knownModels = stored(KNOWN, {});
let hiddenModels = new Set([].concat(stored(HIDDEN, [])));
let editingModels = false;
let fetchingModels = false;
let account = null;
let accountFault = "";
const connecting = () => settings.getState().connecting;
const claudeCodeAbsent = (reason) => String(reason).startsWith("no encuentro Claude Code");
let usage = null;
const choice = { provider: "", model: "" };
const knobs = {
  effort: stored(EFFORT, ""),
  thinking: stored(THINKING, true) !== false,
  mode: MODES.some((one) => one.id === stored(MODE, "")) ? stored(MODE, "") : "default",
};

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function prettyModel(id) {
  const [family, ...rest] = id.replace(/^claude-/, "").replace(/\[.*$/, "").split("-");
  const version = [];
  for (const part of rest) {
    if (!/^\d{1,7}$/.test(part)) break;
    version.push(part);
  }
  return [capital(family), version.join(".")].filter(Boolean).join(" ");
}

function modelName(id) {
  if (!id) return "Claude";
  const card = catalog.flatMap(modelsOf).find((one) => one.id === id);
  return card ? card.label : prettyModel(id);
}

const chosenCard = () => (knownModels[choice.provider] || []).find((card) => card.id === choice.model);

function effortNow(card = chosenCard()) {
  const levels = card?.efforts || [];
  return levels.includes(knobs.effort) ? knobs.effort : card?.effort || "";
}

function currentSettings() {
  const card = chosenCard();
  return {
    provider: choice.provider,
    model: choice.model,
    effort: effortNow(card),
    thinking: card?.thinking === "always" || knobs.thinking,
    mode: knobs.mode,
  };
}

function paintKnobs() {
  const card = chosenCard();
  paintEffort(card);

  const always = card?.thinking === "always";
  const on = always || knobs.thinking;
  thinkBtn.hidden = !card;
  thinkBtn.setAttribute("aria-pressed", String(on));
  thinkBtn.setAttribute("aria-disabled", String(always));
  thinkBtn.title = always
    ? "Este modelo razona siempre"
    : on ? "Razona antes de responder. Pulsa para desactivarlo." : "Responde sin razonar. Pulsa para activarlo.";

  const mode = MODES.find((one) => one.id === knobs.mode);
  modeLabel.textContent = mode.label;
  modeBtn.title = mode.said;
  modeBtn.dataset.risky = String(Boolean(mode.risky));
}

function knobRow(label, checked, act, sub) {
  const row = el("button", "menu-item");
  row.tabIndex = -1;
  row.setAttribute("role", "menuitemradio");
  row.setAttribute("aria-checked", String(checked));
  const text = el("span", "mode-text");
  text.append(el("span", null, label));
  if (sub) text.append(el("span", "mode-sub", sub));
  const tick = el("span", "model-tick");
  tick.innerHTML = ICONS.check;
  row.append(text, tick);
  row.addEventListener("click", act);
  return row;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((step) => (step + 0.5) / 16);
const CELL = 3;
const calm = matchMedia("(prefers-reduced-motion: reduce)");

const ENTER = 1500;
const FRONT_SOFT = 0.18;

let pixelLoop = 0;
let pixelStart = 0;
let pixelInk = "";
let phases = null;
let phaseGrid = "";

function phaseTable(cols, rows) {
  const key = `${cols}x${rows}`;
  if (phases && phaseGrid === key) return phases;
  phaseGrid = key;
  phases = new Float32Array(cols * rows);
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const seed = Math.sin(col * 12.9898 + row * 78.233) * 43758.5453;
      phases[col * rows + row] = (seed - Math.floor(seed)) * Math.PI * 2;
    }
  }
  return phases;
}

function drawPixels(millis) {
  pixelStart ||= millis;
  const ctx = effortPixels.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const wide = Math.max(1, Math.round(effortPixels.clientWidth));
  const tall = Math.max(1, Math.round(effortPixels.clientHeight));

  if (effortPixels.width !== wide * ratio || effortPixels.height !== tall * ratio) {
    effortPixels.width = wide * ratio;
    effortPixels.height = tall * ratio;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, wide, tall);
  ctx.fillStyle = pixelInk ||= getComputedStyle(document.documentElement).getPropertyValue("--focus").trim();

  const cols = Math.ceil(wide / CELL);
  const rows = Math.ceil(tall / CELL);
  const time = millis / 1000;
  const table = phaseTable(cols, rows);
  const entered = calm.matches ? 1 : Math.min((millis - pixelStart) / ENTER, 1);
  const eased = entered * entered * (3 - 2 * entered);
  const front = (1 - eased) * (1 + FRONT_SOFT) - FRONT_SOFT;

  for (let col = 0; col < cols; col++) {
    const across = (col + 0.5) / cols;
    const gate = Math.min(Math.max((across - front) / FRONT_SOFT, 0), 1);
    if (gate <= 0) continue;
    const density = (0.28 + across ** 2.6 * 2.1) * gate;
    const glow = (0.16 + 0.84 * across) * gate;
    for (let row = 0; row < rows; row++) {
      const swell = 0.14 * gate * Math.sin(time * 1.1 + table[col * rows + row]);
      const lit = (density + swell - BAYER[(col % 4) * 4 + (row % 4)]) * 2.6;
      if (lit <= 0.02) continue;
      ctx.globalAlpha = Math.min(lit, 1) * glow;
      ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
    }
  }
  ctx.globalAlpha = 1;
  pixelLoop = calm.matches || !pixelsWanted() ? 0 : requestAnimationFrame(drawPixels);
}

const pixelsWanted = () => effortBox.dataset.max === "true" && !effortPanel.hidden;

function runPixels(on) {
  if (on === Boolean(pixelLoop)) return;
  if (!on) {
    cancelAnimationFrame(pixelLoop);
    pixelLoop = 0;
    return;
  }
  pixelStart = 0;
  pixelLoop = requestAnimationFrame(drawPixels);
}

const effortLevels = (card = chosenCard()) => card?.efforts || [];

function paintEffort(card) {
  const levels = effortLevels(card);
  effortBox.hidden = levels.length < 2;
  if (effortBox.hidden) {
    runPixels(false);
    return;
  }

  const at = Math.max(0, levels.indexOf(effortNow(card)));
  const last = levels.length - 1;
  const said = EFFORT_NAMES[levels[at]] || levels[at];

  effortBox.dataset.max = String(at === last);
  effortLabel.textContent = said;
  effortNowLabel.textContent = said;
  effortBtn.title = `Esfuerzo ${said}`;
  runPixels(pixelsWanted());
  effortTrack.style.setProperty("--at", String(at / last));
  effortTrack.setAttribute("aria-valuemax", String(last));
  effortTrack.setAttribute("aria-valuenow", String(at));
  effortTrack.setAttribute("aria-valuetext", said);
  effortTrack.title = `Esfuerzo ${said}`;
  if (effortTicks.childElementCount !== levels.length) {
    effortTicks.replaceChildren(...levels.map(() => el("span")));
  }
}

function pickEffort(at) {
  const levels = effortLevels();
  const level = levels[Math.min(Math.max(at, 0), levels.length - 1)];
  if (!level || level === effortNow()) return;
  knobs.effort = level;
  store(EFFORT, level);
  paintKnobs();
  warm();
}

const effortAt = (clientX) => {
  const box = effortTrack.getBoundingClientRect();
  const last = effortLevels().length - 1;
  return Math.round(((clientX - box.left) / box.width) * last);
};

const dropPointer = (event) => {
  if (effortTrack.hasPointerCapture(event.pointerId)) effortTrack.releasePointerCapture(event.pointerId);
};

effortTrack.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  pickEffort(effortAt(event.clientX));
  try {
    effortTrack.setPointerCapture(event.pointerId);
  } catch (ignored) {}
});

effortTrack.addEventListener("pointermove", (event) => {
  if (!effortTrack.hasPointerCapture(event.pointerId)) return;
  if (!(event.buttons & 1)) return dropPointer(event);
  pickEffort(effortAt(event.clientX));
});

effortTrack.addEventListener("pointerup", dropPointer);
effortTrack.addEventListener("pointercancel", dropPointer);

effortTrack.addEventListener("keydown", (event) => {
  const last = effortLevels().length - 1;
  const now = Number(effortTrack.getAttribute("aria-valuenow"));
  const to = { ArrowLeft: now - 1, ArrowDown: now - 1, ArrowRight: now + 1, ArrowUp: now + 1, Home: 0, End: last }[event.key];
  if (to === undefined) return;
  event.preventDefault();
  pickEffort(to);
});

effortHelp.innerHTML = ICONS.question;
effortHelp.title = EFFORT_HELP;
effortHelp.setAttribute("aria-label", EFFORT_HELP);

function chooseMode(id) {
  if (!MODES.some((one) => one.id === id)) return;
  knobs.mode = id;
  store(MODE, id);
  paintKnobs();
}

function paintModeMenu() {
  const rows = MODES.map((mode) => {
    const row = knobRow(mode.label, mode.id === knobs.mode, () => {
      chooseMode(mode.id);
      modeSheet.shut();
      modeBtn.focus();
    }, mode.said);
    if (mode.risky) row.dataset.risky = "true";
    return row;
  });
  modePanel.replaceChildren(el("div", "menu-head", "Permisos"), ...rows);
}

const modelRows = document.getElementById("model-rows");
const modelNote = document.getElementById("model-note");
const accountLine = document.getElementById("model-account");
const connectBtn = document.getElementById("models-connect");
const refreshBtn = document.getElementById("models-refresh");
const editBtn = document.getElementById("models-edit");

const modelsOf = (provider) => knownModels[provider.id] || [];
const offeredBy = (provider) => modelsOf(provider).filter((card) => !hiddenModels.has(card.id));

function settleChoice() {
  const offered = catalog.flatMap((provider) =>
    offeredBy(provider).map((card) => ({ provider, card })),
  );
  const kept =
    offered.find(({ provider, card }) => provider.id === choice.provider && card.id === choice.model) ||
    offered[0];
  const provider = kept ? kept.provider : catalog[0];
  if (!provider) return;

  choice.provider = provider.id;
  choice.model = kept ? kept.card.id : "";
  crewLabel.textContent = kept ? kept.card.label : provider.label;
  store(RECALL, choice);
  paintKnobs();
}

function modelShownRow(card) {
  const row = el("button", "menu-item");
  row.tabIndex = -1;
  row.dataset.id = card.id;
  row.setAttribute("role", "menuitemcheckbox");
  row.setAttribute("aria-checked", String(!hiddenModels.has(card.id)));
  const box = el("span", "model-box");
  box.innerHTML = ICONS.check;
  row.append(box, el("span", null, card.label));
  row.addEventListener("click", () => {
    if (hiddenModels.has(card.id)) hiddenModels.delete(card.id);
    else hiddenModels.add(card.id);
    store(HIDDEN, [...hiddenModels]);
    settleChoice();
    paintModels();
    modelRows.querySelector(`[data-id="${CSS.escape(card.id)}"]`)?.focus();
  });
  return row;
}

function modelRow(provider, card) {
  if (editingModels) return modelShownRow(card);
  const chosen = provider.id === choice.provider && card.id === choice.model;
  const said = card.latest ? MODEL_SAID[card.description] || card.description : "";
  const picked = knobRow(card.label, chosen, () => {
    choice.provider = provider.id;
    choice.model = card.id;
    settleChoice();
    modelSheet.shut();
    pickBtn.focus();
  }, said);
  picked.dataset.id = card.id;
  return picked;
}

function providerRows(provider) {
  const head = el("div", "menu-head");
  head.append(el("span", "vendor", provider.vendor), ` · ${provider.label}`);
  const cards = editingModels ? modelsOf(provider) : offeredBy(provider);
  const rowOf = (card) => modelRow(provider, card);
  const latest = cards.filter((card) => card.latest);
  const older = cards.filter((card) => !card.latest);
  if (cards.length) {
    return [
      head,
      ...latest.map(rowOf),
      ...(older.length ? [el("div", "menu-head", "Anteriores"), ...older.map(rowOf)] : []),
    ];
  }

  const empty = fetchingModels
    ? "Buscando modelos…"
    : modelsOf(provider).length ? "Todos ocultos" : "Sin modelos todavía";
  return [head, el("div", "model-quiet", empty)];
}

function paintTool(button, glyph, text) {
  button.innerHTML = glyph;
  button.append(el("span", null, text));
}

function paintModels() {
  modelRows.replaceChildren(...catalog.flatMap(providerRows));
  refreshBtn.disabled = fetchingModels;
  paintTool(refreshBtn, ICONS.refresh, fetchingModels ? "Actualizando…" : "Actualizar modelos");
  paintTool(editBtn, editingModels ? ICONS.check : ICONS.settings, editingModels ? "Listo" : "Editar modelos…");
}

async function refreshModels() {
  if (fetchingModels) return;
  fetchingModels = true;
  store(ASKED, new Date().toDateString());
  modelNote.hidden = true;
  paintModels();

  const failures = [];
  for (const provider of catalog) {
    try {
      knownModels[provider.id] = await invoke("models", { provider: provider.id });
    } catch (reason) {
      if (!claudeCodeAbsent(reason)) failures.push(`${provider.label}: ${reason}`);
    }
  }
  store(KNOWN, knownModels);

  fetchingModels = false;
  modelNote.textContent = failures.join(" · ");
  modelNote.hidden = failures.length === 0;
  settleChoice();
  paintModels();
}

async function loadCatalog() {
  catalog = await invoke("providers");
  if (!catalog.length) return;

  Object.assign(choice, stored(RECALL, {}));
  settleChoice();
  paintModels();
  refreshWhenDue();
  readAccount();
}

function refreshWhenDue() {
  const missing = catalog.some((provider) => !modelsOf(provider).length);
  const stale = stored(ASKED, "") !== new Date().toDateString();
  if (missing || stale) refreshModels();
}


const BILLED = {
  subscription: ({ plan, source, email }) => [`Suscripción ${PLANS[plan] || plan}`.trim(), source, email],
  noPlan: ({ email }) => [email, "sin plan Pro ni Max"],
  elsewhere: ({ source }) => [source === API_KEY_SOURCE ? "Clave de API de la Consola" : `Claude Code usa ${source}, no tu suscripción`],
  signedOut: () => ["Claude Code no tiene sesión"],
};

const signInOffered = () => connecting() || Boolean(accountFault) || ["signedOut", "noPlan"].includes(account?.billing);
const accountTrouble = (reason) => (claudeCodeAbsent(reason) ? "Falta Claude Code" : String(reason));

function usageText() {
  const window = usage?.five_hour;
  if (typeof window?.utilization !== "number") return "";
  return `${Math.round(window.utilization * 100)} % usado en 5 h`;
}

function paintAccount() {
  const said = accountFault ? [accountFault] : account ? BILLED[account.billing](account) : [];
  if (account?.billing === "subscription") said.push(usageText());
  accountLine.textContent = said.filter(Boolean).join(" · ");
  accountLine.hidden = !accountLine.textContent;
  accountLine.classList.toggle("warn", Boolean(accountFault) || (account?.billing !== "subscription" && !keyed(account)));

  connectBtn.hidden = !signInOffered();
  connectBtn.disabled = connecting();
  paintTool(connectBtn, ICONS.logIn, connecting() ? "Esperando al inicio de sesión…" : "Conectar Claude Code…");
}

settings.subscribe((now, before) => {
  if (now.connecting !== before.connecting) paintAccount();
});

async function readAccount() {
  try {
    account = await invoke("claude_account");
    accountFault = "";
  } catch (reason) {
    account = null;
    accountFault = accountTrouble(reason);
  }
  paintAccount();
  return account;
}

const PASTEABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const PICTURE_CAP = 5 * 1024 * 1024;
let pasted = [];

function clip(label, weight, forget, src) {
  const node = el("div", src ? "clip picture" : "clip");
  if (src) {
    const thumb = el("img");
    thumb.src = src;
    thumb.alt = "";
    node.append(thumb);
  }
  node.append(el("span", null, label), el("b", null, weight));
  const drop = el("button");
  drop.title = `Quitar ${label}`;
  drop.setAttribute("aria-label", drop.title);
  drop.innerHTML =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  drop.addEventListener("click", () => {
    forget();
    paintClips();
    syncSend();
  });
  node.append(drop);
  return node;
}

const fileLabel = (file) => (file.outside ? file.name : file.path);

function paintClips() {
  clipRow.hidden = attached.length === 0 && pasted.length === 0;
  clipRow.replaceChildren(
    ...pasted.map((picture) =>
      clip(picture.name, weigh(picture.bytes), () => (pasted = pasted.filter((other) => other !== picture)), picture.url)),
    ...attached.map((file) =>
      clip(fileLabel(file), weigh(file.bytes), () => (attached = attached.filter((other) => other.path !== file.path)))),
  );
}

async function attachPaths(paths) {
  if (!root || !paths.length) return;
  let found;
  try {
    found = await invoke("attach", { root, paths });
  } catch (reason) {
    warn(String(reason));
    return;
  }
  for (const item of found.items) {
    if (item.kind === "picture") {
      pasted.push({ name: item.name, bytes: item.bytes, mediaType: item.mediaType, url: `data:${item.mediaType};base64,${item.data}` });
    } else if (!attached.some((file) => file.path === item.path)) {
      attached.push(item);
    }
  }
  for (const reason of found.refused) warn(reason);
  paintClips();
  syncSend();
}

const readAsUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.addEventListener("load", () => resolve(reader.result));
  reader.addEventListener("error", () => reject(reader.error));
  reader.readAsDataURL(file);
});

async function takePictures(files) {
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
    pasted.push({ name, bytes: file.size, mediaType: file.type, url: await readAsUrl(file) });
  }
  paintClips();
  syncSend();
}

function paintChip() {
  branchBtn.hidden = !repo;
  if (!repo) return;
  branchLabel.textContent = repo.branch;
  branchDot.hidden = repo.dirty === 0;
  const pending = repo.dirty === 1 ? "1 fichero sin confirmar" : `${repo.dirty} ficheros sin confirmar`;
  branchBtn.title = [
    repo.detached ? `HEAD suelto en ${repo.branch}` : repo.branch,
    repo.dirty ? pending : "",
  ].filter(Boolean).join(" · ");
}

function branchRow(name, here) {
  const row = el("button", "branch-row");
  row.setAttribute("aria-current", String(here));
  row.title = name;
  row.append(el("span", "name", name));
  const tip = el("span", "tip");
  tip.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  row.append(tip);
  row.addEventListener("click", () => (here ? branchSheet.shut() : switchTo(name)));
  return row;
}

function paintBranches() {
  if (!repo) return;
  const needle = branchFilter.value.trim().toLowerCase();
  const others = repo.branches.filter((name) => name !== repo.branch);
  const shown = needle ? others.filter((name) => name.toLowerCase().includes(needle)) : others;

  branchHere.replaceChildren(branchRow(repo.branch, true));
  branchRows.replaceChildren(...shown.map((name) => branchRow(name, false)));
  if (!shown.length) {
    branchRows.append(el("p", "none", needle ? "Ninguna rama coincide." : "No hay más ramas."));
  }
}

async function readRepo() {
  repo = root ? await invoke("repo", { root }) : null;
  paintChip();
  if (!branchPanel.hidden) paintBranches();
}

async function switchTo(name) {
  branchSheet.shut();
  try {
    repo = await invoke("checkout", { root, branch: name });
  } catch (reason) {
    warn(String(reason));
    return;
  }
  paintChip();
  notice(["rama · ", { bold: repo.branch }]);
  forgetEdits();
  forgetChanges();
  await loadFiles();
  const { opened } = viewer.getState();
  if (opened) await openFile(opened);
}

const canSend = () => Boolean(root && choice.provider && (taskInput.value.trim() || pasted.length));

function syncSend() {
  const { busy, stopping } = chat.getState();
  sendBtn.disabled = busy ? stopping : !canSend();
  const label = busy ? (stopping ? "Parando…" : "Parar") : "Enviar";
  sendBtn.title = label;
  sendBtn.setAttribute("aria-label", label);
  attachBtn.disabled = !root || busy;
  folderBtn.disabled = busy;
  branchBtn.disabled = busy;
}

const HARMONICS = [1, 2, 3];
const SWELL = [0.04, 0.12];
const SAMPLES = 60;
const LAP = [2800, 4000];

const between = ([low, high]) => low + Math.random() * (high - low);

function lapSpeed() {
  const waves = HARMONICS.map((turns) => ({
    turns,
    swell: between(SWELL) / turns,
    phase: Math.random() * Math.PI * 2,
  }));

  return (at) =>
    waves.reduce(
      (speed, wave) =>
        speed +
        wave.swell *
          (Math.sin(2 * Math.PI * wave.turns * at + wave.phase) -
            Math.sin(wave.phase)),
      1,
    );
}

function lapKeyframes(name) {
  const speed = lapSpeed();
  const walked = [0];
  for (let step = 1; step <= SAMPLES; step++) {
    walked.push(walked[step - 1] + speed((step - 0.5) / SAMPLES));
  }

  const lap = walked[SAMPLES];
  const rows = walked.map(
    (far, step) =>
      `${((step / SAMPLES) * 100).toFixed(2)}% { --spin: ${((far / lap) * 360).toFixed(2)}deg; }`,
  );

  return `@keyframes ${name} { ${rows.join(" ")} }`;
}

const laps = document.createElement("style");
document.head.append(laps);
let lapTurn = 0;

function reseedLap() {
  lapTurn = 1 - lapTurn;
  const name = `orbit-${lapTurn}`;
  laps.textContent = lapKeyframes(name);
  composerBox.style.setProperty("--lap-name", name);
  composerBox.style.setProperty("--lap-time", `${Math.round(between(LAP))}ms`);
}

composerBox.addEventListener("animationiteration", (event) => {
  if (event.pseudoElement !== "::after") return;
  reseedLap();
});

const GROW_CAP = 260;
let grown = 0;

function fit() {
  const cap = Math.max(96, Math.min(GROW_CAP, Math.round(window.innerHeight * 0.4)));
  taskInput.style.transition = "none";
  taskInput.style.height = "auto";
  const wanted = Math.min(taskInput.scrollHeight, cap);
  taskInput.style.height = `${grown || wanted}px`;
  void taskInput.offsetHeight;
  taskInput.style.transition = "";
  taskInput.style.height = `${wanted}px`;
  taskInput.dataset.capped = String(wanted >= cap);
  grown = wanted;
}

async function send() {
  if (chat.getState().busy || !canSend()) return;
  const text = taskInput.value.trim();
  const files = attached.map((file) => file.path);
  const shownFiles = attached.map(fileLabel);
  const pictures = pasted.map((picture) => picture.url);
  const images = pasted.map((picture) => ({
    mediaType: picture.mediaType,
    data: picture.url.slice(picture.url.indexOf(",") + 1),
  }));
  taskInput.value = "";
  fit();
  attached = [];
  pasted = [];
  paintClips();
  await sendChat({ message: { text, files, images }, shownFiles, pictures }, currentSettings());
}

folderBtn.addEventListener("click", chooseFolder);

panel.addEventListener("close", syncBrowser);

for (const shut of codePanel.querySelectorAll(".shut-tool")) {
  shut.innerHTML = ICONS.close;
  shut.addEventListener("click", closeTools);
}
changesReload.innerHTML = ICONS.refresh;
changesReload.addEventListener("click", loadChanges);
document.getElementById("toggle-tree").addEventListener("click", (event) => {
  const shown = codeBody.dataset.tree !== "hidden";
  codeBody.dataset.tree = shown ? "hidden" : "shown";
  event.currentTarget.setAttribute("aria-pressed", String(!shown));
});

function popover(sheet, anchor, before) {
  const one = {
    sheet,
    anchor,
    shut() {
      if (sheet.hidden) return;
      sheet.hidden = true;
      one.anchor.setAttribute("aria-expanded", "false");
      syncBrowser();
    },
    open(from = one.anchor) {
      for (const other of sheets) other.shut();
      one.anchor = from;
      if (before) before();
      sheet.hidden = false;
      from.setAttribute("aria-expanded", "true");
      sheet.querySelector('input, [role^="menuitem"]')?.focus();
      syncBrowser();
    },
    toggle(from = one.anchor) {
      if (!sheet.hidden && one.anchor === from) one.shut();
      else one.open(from);
    },
  };
  anchor?.addEventListener("click", () => one.toggle());
  sheets.push(one);
  return one;
}

function steer(one) {
  one.sheet.addEventListener("keydown", (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const items = [...one.sheet.querySelectorAll('[role^="menuitem"]:not(:disabled):not([hidden])')];
    const at = items.indexOf(document.activeElement);
    items[(at + step + items.length) % items.length].focus();
  });
  one.sheet.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (next && !one.sheet.contains(next) && next !== one.anchor) one.shut();
  });
  return one;
}

const modelSheet = steer(popover(picker, pickBtn, () => {
  editingModels = false;
  paintModels();
  refreshWhenDue();
  if (!connecting()) readAccount();
}));

const modeSheet = steer(popover(modePanel, modeBtn, paintModeMenu));

popover(effortPanel, effortBtn, () => paintEffort(chosenCard()));
effortBtn.addEventListener("click", () => runPixels(pixelsWanted()));

thinkBtn.querySelector(".toggle-icon").innerHTML = ICONS.brain;

thinkBtn.addEventListener("click", () => {
  if (thinkBtn.getAttribute("aria-disabled") === "true") return;
  knobs.thinking = !knobs.thinking;
  store(THINKING, knobs.thinking);
  paintKnobs();
});

connectBtn.addEventListener("click", () => {
  modelSheet.shut();
  openSettingsView("providers");
});
refreshBtn.addEventListener("click", refreshModels);
editBtn.addEventListener("click", () => {
  editingModels = !editingModels;
  paintModels();
  editBtn.focus();
});
const branchSheet = popover(branchPanel, branchBtn, () => {
  branchFilter.value = "";
  paintBranches();
});

branchFilter.addEventListener("input", paintBranches);

const toolSheet = steer(popover(toolMenu, toolBtn, paintToolMenu));

document.addEventListener("pointerdown", (event) => {
  for (const one of sheets) {
    if (one.sheet.hidden || one.sheet.contains(event.target) || one.anchor.contains(event.target)) continue;
    one.shut();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const one of sheets) {
    if (one.sheet.hidden) continue;
    one.shut();
    one.anchor.focus();
  }
});

// Where the focus goes back when the shared dialog closes.
let panelBack = null;

function showPanel(title, ...nodes) {
  panelTitle.textContent = title;
  panelBody.replaceChildren(...nodes);
  panel.showModal();
  syncBrowser();
}

function preview(title, back, node) {
  panelBack = back;
  panel.dataset.wide = "true";
  showPanel(title, node);
}

function openSettingsView(section) {
  showSection(section);
  showView("settings");
}

const updateBtn = document.getElementById("update");

function paintUpdates({ latest: next }) {
  updateBtn.hidden = !next;
  if (next) {
    updateBtn.innerHTML = ICONS.update;
    updateBtn.append(el("span", null, next.version));
    updateBtn.setAttribute("aria-label", `Actualización disponible: Sens ${next.version}`);
    updateBtn.title = `Sens ${next.version} disponible`;
  }
}

updates.subscribe(paintUpdates);

updateBtn.addEventListener("click", () => openUpdate(updateBtn));

document.getElementById("panel-close").addEventListener("click", () => panel.close());
panel.addEventListener("click", (event) => {
  if (event.target === panel) panel.close();
});
panel.addEventListener("close", () => {
  panel.dataset.wide = "false";
  panelBody.replaceChildren();
  if (panelBack?.isConnected) panelBack.focus();
  panelBack = null;
});

const RAIL_CLOSED = "sens.rail.closed";
const railBtn = document.getElementById("toggle-rail");
const railNav = document.getElementById("rail");

function paintRailToggle() {
  const closed = body.dataset.rail === "closed";
  const label = closed ? "Mostrar la barra lateral" : "Ocultar la barra lateral";
  railBtn.innerHTML = closed ? ICONS.panelOpen : ICONS.panelClose;
  railBtn.title = `${label} (Ctrl+B)`;
  railBtn.setAttribute("aria-label", label);
  railBtn.setAttribute("aria-expanded", String(!closed));
  railNav.inert = closed;
}

function toggleRail() {
  const closed = body.dataset.rail !== "closed";
  body.dataset.rail = closed ? "closed" : "open";
  store(RAIL_CLOSED, closed);
  paintRailToggle();
}

body.dataset.rail = stored(RAIL_CLOSED, false) === true ? "closed" : "open";
paintRailToggle();
railBtn.addEventListener("click", toggleRail);

const SIZES = "sens.sizes";
const SIZE_STEP = 16;

function keepSize(name, width) {
  const sizes = stored(SIZES, {});
  if (width) sizes[name] = width;
  else delete sizes[name];
  store(SIZES, sizes);
}

function splitter(handle, { host, name, pane, grow }) {
  const width = () => Math.round(pane.getBoundingClientRect().width);
  const set = (px) => host.style.setProperty(name, `${Math.round(px)}px`);
  const kept = stored(SIZES, {})[name];
  if (kept) set(kept);

  function resize(px) {
    set(px);
    const now = width();
    set(now);
    handle.setAttribute("aria-valuenow", String(now));
    return now;
  }

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const from = event.clientX;
    const start = width();
    handle.setPointerCapture(event.pointerId);
    handle.dataset.dragging = "true";
    body.dataset.sizing = "true";
    const move = (moved) => set(start + (moved.clientX - from) * grow);
    const done = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", done);
      handle.removeEventListener("pointercancel", done);
      delete handle.dataset.dragging;
      keepSize(name, resize(width()));
      delete body.dataset.sizing;
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", done);
    handle.addEventListener("pointercancel", done);
  });

  handle.addEventListener("keydown", (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    body.dataset.sizing = "true";
    keepSize(name, resize(width() + step * grow * SIZE_STEP * (event.shiftKey ? 4 : 1)));
    delete body.dataset.sizing;
  });

  handle.addEventListener("focus", () => handle.setAttribute("aria-valuenow", String(width())));

  handle.addEventListener("dblclick", () => {
    host.style.removeProperty(name);
    keepSize(name, 0);
  });
}

splitter(document.getElementById("rail-split"), { host: body, name: "--rail-width", pane: railNav, grow: 1 });
splitter(document.getElementById("panel-split"), { host: body, name: "--tools-width", pane: codePanel, grow: -1 });
splitter(document.getElementById("tree-split"), { host: codeBody, name: "--tree-width", pane: codeBody.querySelector(".tree"), grow: 1 });

const HOTKEYS = { n: fresh, o: chooseFolder, b: toggleRail };

document.addEventListener("keydown", (event) => {
  const act = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && HOTKEYS[event.key.toLowerCase()];
  if (!act) return;
  event.preventDefault();
  if (!panel.open) act();
});

attachBtn.addEventListener("click", async () => {
  if (!root) return;
  const picked = await dialog.open({
    multiple: true,
    title: "Adjuntar ficheros o imágenes",
    defaultPath: root,
  });
  if (picked) await attachPaths([].concat(picked));
});

const Dictation = window.SpeechRecognition || window.webkitSpeechRecognition;
let listening = null;

if (!Dictation) {
  dictateBtn.disabled = true;
  dictateBtn.title = "Este sistema no trae dictado en el WebView";
  dictateBtn.setAttribute("aria-label", dictateBtn.title);
}

function dictate() {
  if (listening) {
    listening.stop();
    return;
  }
  const heard = new Dictation();
  heard.lang = "es-ES";
  heard.continuous = true;
  heard.interimResults = true;

  const before = taskInput.value.trim();
  heard.addEventListener("result", (event) => {
    let said = "";
    for (const result of event.results) said += result[0].transcript;
    taskInput.value = [before, said.trim()].filter(Boolean).join(" ");
    fit();
    syncSend();
  });

  const done = () => {
    listening = null;
    dictateBtn.setAttribute("aria-pressed", "false");
    taskInput.focus();
  };
  heard.addEventListener("end", done);
  heard.addEventListener("error", done);

  heard.start();
  listening = heard;
  dictateBtn.setAttribute("aria-pressed", "true");
}

dictateBtn.addEventListener("click", () => Dictation && dictate());
sendBtn.addEventListener("click", () => (chat.getState().busy ? halt() : send()));
taskInput.addEventListener("input", () => {
  fit();
  syncSend();
  warm();
});

taskInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  send();
});

taskInput.addEventListener("paste", (event) => {
  const pictures = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
  if (!pictures.length) return;
  if (!event.clipboardData.getData("text/plain")) event.preventDefault();
  takePictures(pictures);
});

frame.onDragDropEvent(({ payload }) => {
  const welcome = Boolean(root) && !showing;
  if (payload.type === "enter" || payload.type === "over") {
    if (welcome) composerBox.dataset.drop = "true";
    return;
  }
  delete composerBox.dataset.drop;
  if (payload.type !== "drop" || !welcome) return;
  attachPaths(payload.paths);
  taskInput.focus();
});

const winBar = document.getElementById("win");
const growBtn = document.getElementById("win-max");

async function syncFrame() {
  const wide = await frame.isMaximized();
  winBar.dataset.max = String(wide);
  const label = wide ? "Restaurar" : "Maximizar";
  growBtn.title = label;
  growBtn.setAttribute("aria-label", label);
}

document.getElementById("win-min").addEventListener("click", () => frame.minimize());
growBtn.addEventListener("click", async () => {
  await frame.toggleMaximize();
  syncFrame();
});
document.getElementById("win-close").addEventListener("click", () => frame.close());
frame.onResized(syncFrame);

async function boot() {
  try {
    const last = await invoke("last_project");
    if (last) return draft(last);
  } catch (reason) {
    oweRail(reason);
  }
  await loadRail();
}

Object.assign(legacy, {
  readAccount,
  refreshModels,
  showPanel(title, node, back) {
    if (back) panelBack = back;
    showPanel(title, node);
  },
  closePanel: () => panel.close(),
  panelReturnsTo(back) {
    panelBack = back;
  },
  showTool,
  warn,
  preview,
  resume,
  draft,
  fresh,
  chooseFolder,
  showView,
  panelShows,
  modelName,
  readRepo,
  chooseMode,
  noteLimits(windows) {
    usage = windows;
    paintAccount();
  },
});

hello();
paintKnobs();
paintClips();
syncSend();
loadCatalog();
syncFrame();
loadProfile().then(startUpdates);
boot();
