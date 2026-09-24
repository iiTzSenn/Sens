import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as dialog from "@tauri-apps/plugin-dialog";
import { loadShelf } from "../features/artifacts/store";
import { enterCapabilities } from "../features/capabilities/store";
import { forgetChanges, loadChanges } from "../features/changes/store";
import { loadProfile } from "../features/profile/store";
import { forgetTree, loadFiles } from "../features/files/store";
import { forgetViewer } from "../features/files/view";
import { forgetEdits, project } from "../features/project/store";
import { failRail, fold, loadRail, oweRail } from "../features/rail/store";
import { blank, hello, idle, load, warn } from "../features/chat/store";
import { composer, forgetClips, readRepo } from "../features/composer/store";
import { loadCatalog } from "../features/models/store";
import { openUpdate } from "../features/updates/UpdatePanel";
import { enterSite, forgetSite, syncBrowser } from "../features/web/store";
import { enterSettings } from "../features/settings/store";
import { runningTasks, tasks, tickTasks } from "../features/tasks/store";
import { startUpdates, updates } from "../features/updates/store";
import { anchorMenu } from "../shared/anchorMenu";
import { ICONS } from "../shared/icons.js";
import { sheets } from "../shared/sheets.js";
import { store, stored } from "../shared/storage.js";
import { legacy } from "./bridge";

const frame = getCurrentWindow();

const body = document.getElementById("body");
const codePanel = document.getElementById("code");
const toolBtn = document.getElementById("tools");
const toolMenu = document.getElementById("tool-menu");
const changesReload = document.getElementById("changes-reload");
const codeBody = document.getElementById("code-body");
const chatSection = document.querySelector("section.chat");
const shelf = document.getElementById("shelf");
const capsView = document.getElementById("capabilities-view");
const settingsView = document.getElementById("settings-view");
const panel = document.getElementById("panel");
const panelTitle = document.getElementById("panel-title");
const panelBody = document.getElementById("panel-body");

let root = "";

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
  changes: { label: "Cambios", said: "Lo que difiere del último commit", icon: ICONS.compare, enter: loadChanges, count: () => { const dirty = composer.getState().repo?.dirty; return dirty ? String(dirty) : ""; } },
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

async function enter(picked) {
  root = picked;
  project.setState({ root: picked, session: "" });
  forgetEdits();
  forgetClips();
  forgetSite();
  forgetViewer();
  forgetTree();
  idle(true);
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
  document.getElementById("task")?.focus();
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

const toolSheet = steer(popover(toolMenu, toolBtn, paintToolMenu));

document.addEventListener("pointerdown", (event) => {
  for (const one of sheets) {
    if (!one.sheet || one.sheet.hidden || one.sheet.contains(event.target) || one.anchor?.contains(event.target)) continue;
    one.shut();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const one of sheets) {
    if (!one.sheet || one.sheet.hidden) continue;
    one.shut();
    one.anchor?.focus();
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
});

hello();
loadCatalog();
syncFrame();
loadProfile().then(startUpdates);
boot();
