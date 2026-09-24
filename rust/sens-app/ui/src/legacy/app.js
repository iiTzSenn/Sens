import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as dialog from "@tauri-apps/plugin-dialog";
import { enterCapabilities } from "../features/capabilities/store";
import { plain } from "../features/market/search.js";
import { loadProfile, profile } from "../features/profile/store";
import { project } from "../features/project/store";
import { enterSettings, settings, showSection } from "../features/settings/store";
import { startUpdates, updates } from "../features/updates/store";
import { API_KEY_SOURCE, PLANS, keyed } from "../shared/account";
import { MARKDOWN, compact, stem, weigh, when } from "../shared/format.js";
import { ICONS } from "../shared/icons.js";
import { sheets } from "../shared/sheets.js";
import { store, stored } from "../shared/storage.js";
import { legacy } from "./bridge";

const frame = getCurrentWindow();

const DIFF_PREVIEW = 14;

const body = document.getElementById("body");
const thread = document.getElementById("thread");
const inner = document.getElementById("thread-inner");
const stream = document.getElementById("stream");
const taskInput = document.getElementById("task");
const rootLabel = document.getElementById("root");
const folderBtn = document.getElementById("folder");
const sessionList = document.getElementById("sessions");
const fileList = document.getElementById("filelist");
const where = document.getElementById("where");
const marks = document.getElementById("marks");
const sourcePane = document.getElementById("source");
const codePanel = document.getElementById("code");
const toolBtn = document.getElementById("tools");
const toolMenu = document.getElementById("tool-menu");
const changeList = document.getElementById("changes");
const changeMarks = document.getElementById("change-marks");
const changesReload = document.getElementById("changes-reload");
const taskList = document.getElementById("tasks");
const taskTally = document.getElementById("task-tally");
const siteAddress = document.getElementById("site-address");
const siteUrlInput = document.getElementById("site-url");
const siteOut = document.getElementById("site-out");
const siteEmpty = document.getElementById("site-empty");
const siteFrame = document.getElementById("site-frame");
const siteBack = document.getElementById("site-back");
const siteForward = document.getElementById("site-forward");
const siteLog = document.getElementById("site-log");
const siteConsole = document.getElementById("site-console");
const siteReload = document.getElementById("site-reload");
const siteWidths = document.getElementById("site-widths");
const codeModes = document.getElementById("code-modes");
const modeSource = document.getElementById("mode-source");
const modeView = document.getElementById("mode-view");
const readingPane = document.getElementById("reading");
const codeBody = document.getElementById("code-body");
const filterInput = document.getElementById("filter");
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
const newBtn = document.getElementById("new-session");
const shelfBtn = document.getElementById("artifacts");
const chat = document.querySelector("section.chat");
const shelf = document.getElementById("shelf");
const shelfBar = document.getElementById("shelf-tabs");
const shelfList = document.getElementById("shelf-list");
const shelfProject = document.getElementById("shelf-project");
const shelfTally = document.getElementById("shelf-tally");
const shelfSeek = document.getElementById("shelf-seek");
const shelfSearch = document.getElementById("shelf-search");
const shelfFoot = document.getElementById("shelf-foot");
const capsBtn = document.getElementById("capabilities");
const capsView = document.getElementById("capabilities-view");
const settingsView = document.getElementById("settings-view");
const foot = document.getElementById("rail-foot");
const profileBtn = document.getElementById("profile");
const avatar = document.getElementById("avatar");
const profileName = document.getElementById("profile-name");
const menu = document.getElementById("menu");
const panel = document.getElementById("panel");
const panelTitle = document.getElementById("panel-title");
const panelBody = document.getElementById("panel-body");

let root = "";
let repo = null;
let current = "";
let replyNow = null;
let busy = false;
let stopping = false;
let opened = "";
const touched = new Map();

const el = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
};

function place(node) {
  if (!node.classList.contains("hello")) inner.querySelector(".hello")?.remove();
  inner.append(node);
  thread.scrollTop = thread.scrollHeight;
  return node;
}

const nearBottom = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160;

function paintFades() {
  const room = thread.scrollHeight - thread.clientHeight;
  stream.dataset.over = String(thread.scrollTop > 8);
  stream.dataset.under = String(room - thread.scrollTop > 8);
}

thread.addEventListener("scroll", paintFades, { passive: true });
const watchFades = new ResizeObserver(paintFades);
watchFades.observe(inner);
watchFades.observe(thread);

function follow(change) {
  const stick = nearBottom();
  const made = change();
  if (stick) thread.scrollTop = thread.scrollHeight;
  return made;
}

function tick(parts, tone) {
  const node = el("div", tone ? `tick ${tone}` : "tick");
  node.append(el("span", "dot"));
  const line = el("span");
  for (const part of [].concat(parts)) {
    line.append(typeof part === "string" ? document.createTextNode(part) : part);
  }
  node.append(line);
  return place(node);
}

const bold = (value) => el("b", null, value);

const MARKS = { add: "+", del: "−", "": " ", gap: "⋯" };

function linesCard(rows, preview = DIFF_PREVIEW) {
  const card = el("div", "diff");
  const lines = el("div", "lines");
  const draw = (from, to) => {
    for (const { kind, num, text } of rows.slice(from, to)) {
      const row = el("div", kind ? `row ${kind}` : "row");
      row.append(
        el("span", "num", num ? String(num) : ""),
        el("span", "mark", MARKS[kind]),
        el("span", "src", text),
      );
      lines.append(row);
    }
  };

  draw(0, preview);
  card.append(lines);

  if (rows.length > preview) {
    const more = el("button", "more", `mostrar ${rows.length - preview} líneas más`);
    more.addEventListener("click", () => {
      draw(preview, rows.length);
      more.remove();
    });
    card.append(more);
  }
  return card;
}

function patchView(hunks, preview) {
  const rows = [];
  const added = [];
  let plus = 0;
  let minus = 0;
  for (const hunk of hunks) {
    if (rows.length) rows.push({ kind: "gap", text: "" });
    let before = hunk.oldStart;
    let after = hunk.newStart;
    for (const line of hunk.lines) {
      const mark = line[0];
      const text = line.slice(1);
      if (mark === "+") {
        rows.push({ kind: "add", num: after, text });
        added.push(after++);
        plus++;
      } else if (mark === "-") {
        rows.push({ kind: "del", num: before++, text });
        minus++;
      } else if (mark === " ") {
        rows.push({ kind: "", num: after, text });
        before++;
        after++;
      }
    }
  }
  return { node: linesCard(rows, preview), plus, minus, added };
}

const addedRows = (text) => String(text).split("\n").map((line, at) => ({ kind: "add", num: at + 1, text: line }));

function replacedRows(before, after) {
  return [
    ...String(before).split("\n").map((text) => ({ kind: "del", text })),
    ...String(after).split("\n").map((text) => ({ kind: "add", text })),
  ];
}

function relative(path) {
  if (!path) return "";
  const clean = String(path).replace(/\\/g, "/");
  const base = root.replace(/\\/g, "/").replace(/\/$/, "");
  const inside = base && clean.toLowerCase().startsWith(`${base.toLowerCase()}/`);
  return inside ? clean.slice(base.length + 1) : clean;
}

const oneLine = (text) => String(text || "").replace(/\s+/g, " ").trim();

function outputBlock(text, bad) {
  return el("pre", bad ? "out fault" : "out", String(text || "").replace(/\s+$/, ""));
}

const TODO_ICON = { completed: () => ICONS.check, in_progress: () => ICONS.dot, pending: () => ICONS.circle };

function todoList(todos = []) {
  const list = el("ul", "todos");
  for (const todo of todos) {
    const item = el("li");
    item.dataset.status = todo.status;
    item.insertAdjacentHTML("afterbegin", (TODO_ICON[todo.status] || TODO_ICON.pending)());
    item.append(el("span", null, todo.status === "in_progress" ? todo.activeForm || todo.content : todo.content));
    list.append(item);
  }
  return list;
}

const progressOf = (todos = []) => `${todos.filter((todo) => todo.status === "completed").length}/${todos.length}`;

function pathLook(icon, verb, input) {
  const target = relative(input.file_path || input.notebook_path || "");
  return { icon, verb, target, mono: true, link: target };
}

function mcpLook(name) {
  const [, server, tool] = name.split("__");
  return { icon: ICONS.plug, verb: server, target: tool || "", mono: true, ask: `usar ${server}` };
}

const LOOKS = {
  Read: (input) => pathLook(ICONS.fileText, "Leer", input),
  Edit: (input) => pathLook(ICONS.pencil, "Editar", input),
  MultiEdit: (input) => pathLook(ICONS.pencil, "Editar", input),
  NotebookEdit: (input) => pathLook(ICONS.pencil, "Editar", input),
  Write: (input) => pathLook(ICONS.filePlus, "Escribir", input),
  Bash: (input) => ({ icon: ICONS.terminal, verb: "Ejecutar", target: oneLine(input.command), mono: true }),
  PowerShell: (input) => ({ icon: ICONS.terminal, verb: "Ejecutar", target: oneLine(input.command), mono: true }),
  Grep: (input) => ({ icon: ICONS.search, verb: "Buscar", target: input.pattern, mono: true, meta: input.path ? `en ${relative(input.path)}` : "" }),
  Glob: (input) => ({ icon: ICONS.files, verb: "Listar", target: input.pattern, mono: true }),
  WebFetch: (input) => ({ icon: ICONS.globe, site: input.url, verb: "Leer", target: input.url, mono: true, ask: "abrir" }),
  WebSearch: (input) => ({ icon: ICONS.globe, verb: "Buscar en la web", target: input.query }),
  TodoWrite: (input) => ({ icon: ICONS.listChecks, verb: "Tareas", target: progressOf(input.todos) }),
  Task: (input) => ({ icon: ICONS.split, verb: "Delegar", target: input.description || input.subagent_type || "" }),
  Agent: (input) => ({ icon: ICONS.split, verb: "Delegar", target: input.description || input.subagent_type || "" }),
  Skill: (input) => ({ icon: ICONS.book, verb: "Usar skill", target: input.skill || input.command || "" }),
};

function describe(name, input = {}) {
  if (LOOKS[name]) return LOOKS[name](input);
  if (name.startsWith("mcp__")) return mcpLook(name);
  return { icon: ICONS.wrench, verb: name, target: "" };
}

const SILENT = new Set(["ToolSearch", "AskUserQuestion", "ExitPlanMode"]);
const EDITS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const SHELLS = new Set(["Bash", "PowerShell"]);

const SILENCE = /^\(\w+ completed with no output\)$/;

function terminalView(command, run) {
  const box = el("div", "terminal");
  const line = el("div", "terminal-command");
  line.append(el("span", "prompt", "$"), el("span", null, String(command || "")));
  box.append(line);
  if (!run) return box;

  const stdout = SILENCE.test(run.stdout.trim()) ? "" : run.stdout.replace(/\s+$/, "");
  const stderr = run.stderr.replace(/\s+$/, "");
  if (stdout || stderr) {
    const out = el("pre", "terminal-output");
    if (stdout) out.append(stdout);
    if (stdout && stderr) out.append("\n");
    if (stderr) out.append(el("span", "stderr", stderr));
    box.append(out);
  }
  box.dataset.state = run.failed ? "failed" : "done";
  const said = run.failed ? "Terminó con error" : stdout || stderr ? "" : "Sin salida";
  if (said) box.append(el("div", "terminal-foot", said));
  return box;
}

const RESULT_CAP = 12;

function resultRow(line) {
  const hit = line.match(/^(.+?):(\d+)[:-](.*)$/);
  const path = relative(hit ? hit[1] : line.trim());
  const opens = Boolean(root) && !/\s{2,}/.test(path) && /[\\/.]/.test(path);
  const row = el(opens ? "button" : "div", "result");
  row.title = line;
  row.append(el("span", "path", path));
  if (hit) row.append(el("span", "at", hit[2]), el("span", "hit", hit[3].trim()));
  if (opens) {
    row.type = "button";
    row.addEventListener("click", () => openTouched(path));
  }
  return row;
}

function resultList(lines) {
  const box = el("div", "results");
  const draw = (from, to) => {
    for (const line of lines.slice(from, to)) box.insertBefore(resultRow(line), box.querySelector(".unfold"));
  };
  draw(0, RESULT_CAP);
  if (lines.length > RESULT_CAP) {
    const more = el("button", "unfold", `Mostrar ${lines.length - RESULT_CAP} más`);
    more.type = "button";
    more.addEventListener("click", () => {
      more.remove();
      draw(RESULT_CAP, lines.length);
    });
    box.append(more);
  }
  return box;
}

const hitsOf = (output) =>
  String(output || "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line && !/^Found \d+ /.test(line) && !/^No (files|matches) found/.test(line));

function webLink(url) {
  const link = el("button", "weblink");
  link.type = "button";
  link.title = url;
  link.innerHTML = ICONS.link;
  link.append(el("span", null, url));
  link.addEventListener("click", () => outward(url));
  return link;
}

const FAVICONS = "https://icons.duckduckgo.com/ip3/";
const STRIP_CAP = 4;

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (ignored) {
    return url;
  }
}

function favicon(url) {
  const box = el("span", "favicon");
  box.innerHTML = ICONS.globe;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch (ignored) {
    return box;
  }
  const img = el("img");
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("load", () => box.replaceChildren(img), { once: true });
  img.src = `${FAVICONS}${host}.ico`;
  return box;
}

function paintStrip(strip, links) {
  strip.replaceChildren(...links.slice(0, STRIP_CAP).map((link) => favicon(link.url)));
  if (links.length > STRIP_CAP) strip.append(el("span", "more", `+${links.length - STRIP_CAP}`));
  strip.title = links.map((link) => hostOf(link.url)).join(" · ");
  strip.hidden = !links.length;
}

function sourceList(links) {
  const box = el("div", "results");
  for (const link of links) {
    const row = el("button", "result cited");
    row.type = "button";
    row.title = link.url;
    row.append(favicon(link.url), el("span", "path", link.title || hostOf(link.url)), el("span", "hit", hostOf(link.url)));
    row.addEventListener("click", () => aimSite(link.url));
    box.append(row);
  }
  return box;
}

const searchSummary = (output) =>
  String(output || "")
    .replace(/^Web search results for query:.*\n+/, "")
    .replace(/^Links: \[.*\]\n*/m, "")
    .trim();

const consulting = (links) => (links.length === 1 ? `Consultando ${hostOf(links[0].url)}` : `Revisando ${links.length} fuentes`);

function outcome(name, input, output, error, detail) {
  if (SHELLS.has(name)) {
    const run = {
      stdout: typeof detail?.stdout === "string" ? detail.stdout : output,
      stderr: typeof detail?.stderr === "string" ? detail.stderr : "",
      failed: error,
    };
    return { nodes: [terminalView(input.command, run)] };
  }
  if (error) return { nodes: [outputBlock(output, true)] };

  const patch = Array.isArray(detail?.structuredPatch) ? detail.structuredPatch : [];
  const path = relative(input.file_path || detail?.filePath || "");
  if (EDITS.has(name) && patch.length) {
    const view = patchView(patch);
    return { nodes: [view.node], meta: `+${view.plus} −${view.minus}`, touched: { path, lines: view.added, plus: view.plus, minus: view.minus } };
  }
  if (name === "Write" && detail?.type === "create") {
    const rows = addedRows(detail.content ?? input.content ?? "");
    return { nodes: [linesCard(rows)], meta: `+${rows.length}`, touched: { path, lines: rows.map((row) => row.num), plus: rows.length, minus: 0 } };
  }
  if (name === "Read") {
    const lines = detail?.file?.numLines;
    return { nodes: [], meta: lines ? `${lines} líneas` : "" };
  }
  if (name === "Glob" || name === "Grep") {
    const lines = hitsOf(output);
    const count = name === "Glob" && detail?.numFiles !== undefined ? detail.numFiles : lines.length;
    return { nodes: lines.length ? [resultList(lines)] : [], meta: `${count} ${count === 1 ? "resultado" : "resultados"}` };
  }
  if (name === "TodoWrite") return { nodes: [todoList(input.todos)] };
  if (name === "WebFetch") {
    return { nodes: [webLink(input.url), ...(output.trim() ? [foldedBox(prose(output), lengthy(output))] : [])] };
  }
  if (name === "WebSearch") {
    const summary = searchSummary(output);
    return { nodes: summary ? [foldedBox(prose(summary), lengthy(summary))] : [] };
  }
  if (["Task", "Agent"].includes(name)) {
    return { nodes: output.trim() ? [foldedBox(prose(output), lengthy(output))] : [] };
  }
  return { nodes: output.trim() ? [outputBlock(output)] : [] };
}

function toolCard(name, input) {
  const look = describe(name, input);
  const node = el("details", "step");
  node.dataset.state = "running";

  const icon = el("span", "step-icon");
  if (look.site) icon.append(favicon(look.site));
  else icon.innerHTML = look.icon;
  const target = el(look.link ? "button" : "span", look.mono ? "step-target mono" : "step-target", look.target || "");
  target.title = look.target || "";
  if (look.link) {
    target.type = "button";
    target.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTouched(look.link);
    });
  }
  const meta = el("span", "step-meta", look.meta || "");
  const strip = el("span", "sources");
  strip.hidden = true;
  const summary = el("summary");
  summary.append(icon, el("span", "step-verb", look.verb), target, strip, meta, el("span", "step-state"));
  summary.addEventListener("click", (event) => {
    if (node.classList.contains("empty")) event.preventDefault();
  });

  const body = el("div", "step-body");
  if (name === "TodoWrite") body.append(todoList(input.todos));
  node.append(summary, body);
  node.classList.toggle("empty", !body.childElementCount);

  const consulted = new Map();
  let sources = null;

  return {
    node,
    consult(links) {
      for (const link of links) consulted.set(link.url, link);
      const all = [...consulted.values()];
      paintStrip(strip, all);
      const fresh = sourceList(all);
      if (sources?.isConnected) sources.replaceWith(fresh);
      else body.prepend(fresh);
      sources = fresh;
      node.classList.toggle("empty", !body.childElementCount);
    },
    finish(output, error, detail) {
      node.dataset.state = error ? "failed" : "done";
      const shown = outcome(name, input, output, error, detail);
      if (shown.meta !== undefined) meta.textContent = shown.meta;
      body.replaceChildren(...(sources ? [sources] : []), ...shown.nodes);
      node.classList.toggle("empty", !body.childElementCount);
      if (error) node.open = true;
      if (shown.touched?.path) markTouched(shown.touched);
    },
    halt() {
      if (node.dataset.state === "running") node.dataset.state = "stopped";
    },
  };
}

function answersText(answers) {
  if (!answers || typeof answers !== "object") return "";
  return Object.values(answers).map((value) => [].concat(value).join(", ")).join(" · ");
}

async function decide(card, request, decision) {
  card.lock();
  try {
    await invoke("chat_answer", { sessionId: current, request, decision });
    card.settle(decision.allow, decision.answers);
    return true;
  } catch (reason) {
    card.unlock(String(reason));
    return false;
  }
}

function askShell(icon, title, target, mono) {
  const node = el("div", "ask");
  const glyph = el("span", "ask-icon");
  glyph.innerHTML = icon;
  const head = el("div", "ask-head");
  head.append(glyph, el("span", "ask-title", title));
  if (target) {
    const shown = el("span", mono ? "ask-target mono" : "ask-target", target);
    shown.title = target;
    head.append(shown);
  }
  const body = el("div", "ask-body");
  const actions = el("div", "ask-actions");
  const note = el("p", "ask-note");
  note.hidden = true;
  node.append(head, body, actions, note);

  const card = {
    node,
    body,
    offer(active, choices, request, after) {
      if (!active) {
        actions.hidden = true;
        return;
      }
      node.dataset.state = "waiting";
      for (const [label, primary, decision] of choices) {
        const button = el("button", primary ? "primary" : "quiet", label);
        button.type = "button";
        button.addEventListener("click", async () => {
          const chosen = typeof decision === "function" ? decision() : decision;
          if (!chosen) return;
          if (await decide(card, request, chosen)) after?.(chosen);
        });
        actions.append(button);
      }
    },
    lock() {
      for (const button of actions.querySelectorAll("button")) button.disabled = true;
    },
    unlock(reason) {
      for (const button of actions.querySelectorAll("button")) button.disabled = false;
      note.className = "ask-note fault";
      note.textContent = reason;
      note.hidden = false;
    },
    settle(allowed, answers) {
      node.dataset.state = allowed ? "allowed" : "refused";
      actions.replaceChildren();
      actions.hidden = true;
      note.className = "ask-note";
      note.textContent = allowed ? answersText(answers) || "Permitido" : "Rechazado";
      note.hidden = false;
    },
    expire() {
      if (node.dataset.state === "allowed" || node.dataset.state === "refused") return;
      node.dataset.state = "expired";
      actions.replaceChildren();
      actions.hidden = true;
      note.className = "ask-note";
      note.textContent = "Sin respuesta";
      note.hidden = false;
    },
  };
  return card;
}

function rememberLabel(suggestions = []) {
  if (!suggestions.length) return "";
  const edits = suggestions.some((suggestion) => suggestion.type === "setMode" && suggestion.mode === "acceptEdits");
  return edits ? "Permitir y aceptar ediciones" : "Permitir siempre en esta sesión";
}

function adoptMode(suggestions = []) {
  const switched = suggestions.find((suggestion) => suggestion.type === "setMode");
  if (switched) chooseMode(switched.mode);
}

function permissionPreview(tool, input) {
  if (SHELLS.has(tool)) {
    return [terminalView(input.command), input.description ? el("p", "ask-note", input.description) : null].filter(Boolean);
  }
  if (tool === "Edit") return [linesCard(replacedRows(input.old_string ?? "", input.new_string ?? ""))];
  if (tool === "Write") return [linesCard(addedRows(input.content ?? ""))];
  if (tool === "WebFetch") return [webLink(input.url), input.prompt ? el("p", "ask-note", input.prompt) : null].filter(Boolean);
  if (tool === "WebSearch") return [el("p", "ask-note", input.query || "")];
  return [codeBlock(JSON.stringify(input, null, 2), "json")];
}

function permissionCard(event, active) {
  const look = describe(event.tool, event.input);
  const card = askShell(ICONS.shieldAlert, `Claude quiere ${look.ask || look.verb.toLowerCase()}`, look.target, look.mono);
  card.body.append(...permissionPreview(event.tool, event.input || {}));
  const remember = rememberLabel(event.suggestions);
  const choices = [
    ["Permitir", true, { allow: true }],
    remember && [remember, false, { allow: true, remember: true }],
    ["Rechazar", false, { allow: false }],
  ].filter(Boolean);
  card.offer(active, choices, event.request, (decision) => decision.remember && adoptMode(event.suggestions));
  return card;
}

function planCard(event, active) {
  const card = askShell(ICONS.map, "Plan listo para revisar", "");
  card.body.append(prose(event.input?.plan || ""));
  card.offer(active, [
    ["Aprobar y ejecutar", true, { allow: true, mode: "default" }],
    ["Aprobar y aceptar ediciones", false, { allow: true, mode: "acceptEdits" }],
    ["Seguir planificando", false, { allow: false, message: "Todavía no apruebo el plan. Sigue refinándolo." }],
  ], event.request, (decision) => decision.allow && chooseMode(decision.mode));
  return card;
}

function questionBlock(question) {
  const node = el("div", "question");
  if (question.header) node.append(el("span", "label", question.header));
  node.append(el("p", "q-text", question.question));

  const options = el("div", "options");
  const picked = new Set();
  for (const option of question.options || []) {
    const button = el("button", "option");
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.append(el("span", null, option.label));
    if (option.description) button.append(el("small", null, option.description));
    button.addEventListener("click", () => {
      if (!question.multiSelect) {
        picked.clear();
        for (const other of options.children) other.setAttribute("aria-pressed", "false");
      }
      if (picked.has(option.label)) picked.delete(option.label);
      else picked.add(option.label);
      button.setAttribute("aria-pressed", String(picked.has(option.label)));
    });
    options.append(button);
  }

  const other = el("input", "field");
  other.placeholder = "Otra respuesta…";
  other.autocomplete = "off";
  node.append(options, other);

  return {
    node,
    question: question.question,
    answer() {
      const typed = other.value.trim();
      if (typed) return typed;
      if (!picked.size) return "";
      return question.multiSelect ? [...picked] : [...picked][0];
    },
  };
}

function questionCard(event, active) {
  const questions = event.input?.questions || [];
  const card = askShell(ICONS.question, questions.length > 1 ? "Claude tiene unas preguntas" : "Claude pregunta", "");
  const blocks = questions.map(questionBlock);
  card.body.append(...blocks.map((one) => one.node));

  const collect = () => {
    const answers = Object.fromEntries(blocks.map((one) => [one.question, one.answer()]));
    if (Object.values(answers).some((value) => !value || !value.length)) {
      card.unlock("Responde a cada pregunta o escribe tu respuesta.");
      return null;
    }
    return { allow: true, answers };
  };

  card.offer(active, [
    ["Responder", true, collect],
    ["Que decida Claude", false, { allow: false, message: "El usuario prefiere no responder; decide tú lo más razonable y sigue." }],
  ], event.request);
  return card;
}

function askCard(event, active) {
  if (event.tool === "AskUserQuestion") return questionCard(event, active);
  if (event.tool === "ExitPlanMode") return planCard(event, active);
  return permissionCard(event, active);
}

function thoughtNode() {
  const node = el("details", "thought");
  const summary = el("summary");
  summary.innerHTML = ICONS.shut;
  const label = el("span", null, "Razonando…");
  summary.append(label);
  const text = el("div", "thought-text");
  node.append(summary, text);
  return { node, label, text };
}

function thought() {
  return { thinking: true, body: "", done: false, queued: false, ...thoughtNode() };
}

function paintThought(one) {
  one.queued = false;
  one.text.textContent = one.body;
  one.label.textContent = one.done ? "Razonamiento" : "Razonando…";
}

function scheduleThought(one) {
  if (one.queued) return;
  one.queued = true;
  requestAnimationFrame(() => one.queued && follow(() => paintThought(one)));
}

const REVEAL_FLOOR = 3;
const REVEAL_SPREAD = 8;
const WORD_REACH = 24;
const FADE = 150;

function streamed() {
  return {
    thinking: false,
    node: el("div", "said"),
    target: "",
    shown: 0,
    done: false,
    streaming: false,
    running: false,
    frozen: 0,
    live: null,
    liveLength: 0,
    stamps: [],
  };
}

function splitBlocks(text) {
  const blocks = [];
  let lines = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const marker = line.match(MD_FENCE);
    if (marker) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : marker[1];
    if (!fence && !marker && !line.trim()) {
      if (lines.length) blocks.push(lines.join("\n"));
      lines = [];
      continue;
    }
    lines.push(line);
  }
  if (lines.length) blocks.push(lines.join("\n"));
  return blocks;
}

function mended(source) {
  const fences = source.split("\n").filter((line) => MD_FENCE.test(line)).length;
  if (fences % 2) return source;
  let text = source.replace(/!?\[([^\]]*)\]\([^)]*$/, "$1").replace(/!?\[([^\]\n]*)$/, "$1");
  if ((text.match(/`/g) || []).length % 2) text += "`";
  const bare = text.replace(/`[^`]*`/g, "");
  const closers = [];
  if ((bare.replace(/\*\*/g, "").replace(/^\s*\*\s/gm, "").match(/\*/g) || []).length % 2) closers.push("*");
  if ((bare.match(/\*\*/g) || []).length % 2) closers.push("**");
  if ((bare.match(/__/g) || []).length % 2) closers.push("__");
  return text + closers.join("");
}

function faded(text, age) {
  const span = el("span", "fresh", text);
  span.style.animationDelay = `-${Math.round(age)}ms`;
  return span;
}

function glow(page, stamps, now) {
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  let offset = 0;
  for (const node of nodes) {
    const start = offset;
    const end = offset + node.data.length;
    offset = end;
    if (end <= stamps[0].from) continue;
    const bounds = [start, ...stamps.map((stamp) => stamp.from).filter((at) => at > start && at < end), end];
    const pieces = [];
    for (let at = 0; at < bounds.length - 1; at++) {
      const piece = node.data.slice(bounds[at] - start, bounds[at + 1] - start);
      const stamp = stamps.findLast((one) => one.from <= bounds[at]);
      pieces.push(stamp ? faded(piece, now - stamp.time) : document.createTextNode(piece));
    }
    node.replaceWith(...pieces);
  }
}

function draw(one) {
  const blocks = splitBlocks(one.target.slice(0, one.shown));
  while (one.frozen < blocks.length - 1) {
    const page = prose(blocks[one.frozen]);
    if (one.live) one.live.replaceWith(page);
    else one.node.append(page);
    one.live = null;
    one.liveLength = 0;
    one.stamps = [];
    one.frozen += 1;
  }

  const now = performance.now();
  const page = prose(mended(blocks.at(-1) || ""));
  const length = page.textContent.length;
  if (length > one.liveLength) one.stamps.push({ from: one.liveLength, time: now });
  one.liveLength = length;
  one.stamps = one.stamps.filter((stamp) => now - stamp.time < FADE);
  if (one.stamps.length) glow(page, one.stamps, now);
  if (one.live) one.live.replaceWith(page);
  else one.node.append(page);
  one.live = page;
}

function finalDraw(one) {
  one.node.replaceChildren(prose(one.target));
  one.frozen = 0;
  one.live = null;
}

function advance(one) {
  one.running = false;
  const backlog = one.target.length - one.shown;
  if (backlog <= 0) return;
  let next = Math.min(one.target.length, one.shown + Math.max(REVEAL_FLOOR, Math.ceil(backlog / REVEAL_SPREAD)));
  const space = one.target.slice(next, next + WORD_REACH).search(/\s/);
  if (next < one.target.length && space > 0) next += space;
  one.shown = next;
  const finished = one.done && one.shown >= one.target.length;
  follow(() => (finished ? finalDraw(one) : draw(one)));
  if (!finished) reveal(one);
}

function reveal(one) {
  if (document.hidden) {
    one.shown = one.target.length;
    follow(() => (one.done ? finalDraw(one) : draw(one)));
    return;
  }
  if (one.running) return;
  one.running = true;
  requestAnimationFrame(() => advance(one));
}

function feed(one, text) {
  one.streaming = true;
  one.target += text;
  reveal(one);
}

function settleText(one, text) {
  one.done = true;
  const kept = one.target.slice(0, one.shown);
  one.target = text;
  if (!one.streaming || !text.startsWith(kept)) {
    one.shown = text.length;
    follow(() => finalDraw(one));
    return;
  }
  if (one.shown >= text.length) follow(() => finalDraw(one));
  else reveal(one);
}

function flushText(one) {
  one.done = true;
  one.shown = one.target.length;
  follow(() => finalDraw(one));
}

const whole = (millis) => Math.floor(millis / 1000) * 1000;

function seconds(millis) {
  const total = millis / 1000;
  if (total < 60) return `${total.toLocaleString("es", { maximumFractionDigits: 1 })} s`;
  return `${Math.floor(total / 60)} min ${Math.round(total % 60)} s`;
}

function footOf(event) {
  return [
    event.millis ? seconds(event.millis) : "",
    event.tokensOut ? `${compact(event.tokensOut)} tokens` : "",
    event.stopped ? "detenido" : "",
  ].filter(Boolean).join(" · ");
}

let shownModel = "";

function announce(who, id) {
  if (!id) return;
  const said = modelName(id);
  if (said === shownModel) return;
  const first = !shownModel;
  shownModel = said;
  if (first) return;
  who.textContent = said;
  who.hidden = false;
}

function opening(model) {
  const node = el("div", "turn reply");
  const who = el("div", "who");
  who.hidden = true;
  const flow = el("div", "flow");
  const live = el("div", "live");
  const liveText = el("span", "live-said");
  const liveClock = el("span", "live-clock");
  live.append(el("span", "pulse"), liveText, liveClock);
  live.hidden = true;
  node.append(who, flow, live);
  place(node);
  announce(who, model);

  const began = performance.now();
  const tick = () => (liveClock.textContent = seconds(whole(performance.now() - began)));
  let clock = 0;

  const tools = new Map();
  const asks = new Map();
  const unsettled = [];
  const texts = [];
  let open = null;

  const append = (child) => follow(() => flow.append(child));

  const close = () => {
    open = null;
    live.hidden = true;
    clearInterval(clock);
    clock = 0;
    for (const one of texts) {
      if (!one.done || one.shown < one.target.length) flushText(one);
    }
    for (const one of unsettled.splice(0)) {
      if (one.thinking) {
        one.done = true;
        follow(() => paintThought(one));
      }
    }
    for (const card of asks.values()) card.expire();
    for (const card of tools.values()) card.halt();
  };

  return {
    named(id) {
      announce(who, id);
    },
    working(text) {
      liveText.textContent = text;
      live.hidden = false;
      if (clock) return;
      tick();
      clock = setInterval(tick, 1000);
    },
    delta(thinking, text) {
      if (!open || open.thinking !== thinking) {
        open = thinking ? thought() : streamed();
        unsettled.push(open);
        if (!thinking) texts.push(open);
        append(open.node);
      }
      if (!thinking) {
        feed(open, text);
        return;
      }
      open.body += text;
      scheduleThought(open);
    },
    settle(thinking, text) {
      const at = unsettled.findIndex((one) => one.thinking === thinking);
      const one = at >= 0 ? unsettled.splice(at, 1)[0] : thinking ? thought() : streamed();
      if (at < 0) {
        if (!thinking) texts.push(one);
        append(one.node);
      }
      if (open === one) open = null;
      if (!thinking) {
        settleText(one, text);
        return;
      }
      one.body = text;
      one.done = true;
      follow(() => paintThought(one));
    },
    tool(id, name, input) {
      open = null;
      if (SILENT.has(name)) return;
      const card = toolCard(name, input || {});
      tools.set(id, card);
      append(card.node);
    },
    toolDone(id, output, error, detail) {
      const card = tools.get(id);
      if (card) follow(() => card.finish(output, error, detail));
    },
    consulted(id, links) {
      const card = tools.get(id);
      if (card) follow(() => card.consult(links));
    },
    asking(event, active) {
      open = null;
      const card = askCard(event, active);
      asks.set(event.request, card);
      append(card.node);
    },
    answered(event) {
      asks.get(event.request)?.settle(event.allowed, event.answers);
    },
    finished(event) {
      close();
      if (event.error) append(el("p", "reply-fault", event.error));
      const foot = footOf(event);
      if (foot) append(el("div", "reply-foot", foot));
    },
    failed(reason) {
      close();
      append(el("p", "reply-fault", reason));
    },
  };
}

function statusOf(name, input) {
  const look = describe(name, input || {});
  return [look.verb, look.target].filter(Boolean).join(" · ");
}

function route(reply, event, live) {
  switch (event.kind) {
    case "started":
      reply.named(event.model);
      if (live) reply.working("Trabajando…");
      break;
    case "delta":
      reply.delta(event.thinking, event.text);
      if (live) reply.working(event.thinking ? "Razonando…" : "Escribiendo…");
      break;
    case "said":
      reply.settle(false, event.text);
      break;
    case "thought":
      reply.settle(true, event.text);
      break;
    case "tool":
      reply.tool(event.id, event.name, event.input);
      if (live && !SILENT.has(event.name)) reply.working(statusOf(event.name, event.input));
      break;
    case "toolDone":
      reply.toolDone(event.id, event.output, event.error, event.detail);
      break;
    case "consulted":
      reply.consulted(event.tool, event.links);
      if (live) reply.working(consulting(event.links));
      break;
    case "asking":
      reply.asking(event, live);
      if (live) reply.working("Esperando tu respuesta");
      break;
    case "answered":
      reply.answered(event);
      break;
    case "finished":
      reply.finished(event);
      break;
    case "failed":
      reply.failed(event.reason);
      break;
  }
}

const inRoot = (relative) => `${root.replace(/[\\/]+$/, "")}/${relative}`;

function pictureRow(sources) {
  const row = el("div", "asked-pictures");
  for (const source of sources) {
    const button = el("button");
    button.type = "button";
    button.title = "Ver imagen";
    button.setAttribute("aria-label", button.title);
    const img = el("img");
    img.alt = "";
    button.append(img);
    Promise.resolve(source).then((src) => (img.src = src), () => button.remove());
    button.addEventListener("click", () => {
      if (!img.src) return;
      const shown = el("img", "sight");
      shown.alt = "Imagen enviada";
      shown.src = img.src;
      preview("Imagen enviada", button, shown);
    });
    row.append(button);
  }
  return row;
}

function asked(text, files = [], pictures = []) {
  const node = el("div", "turn you");
  node.append(el("div", "body-text", text));
  if (pictures.length) node.append(pictureRow(pictures));
  if (files.length) {
    const list = el("div", "asked-files");
    for (const file of files) list.append(el("span", null, file));
    node.append(list);
  }
  return place(node);
}

const dayOf = (offset) => {
  const day = new Date();
  day.setDate(day.getDate() - offset);
  return day.toDateString();
};

function ago(millis) {
  const at = new Date(millis);
  if (at.toDateString() === dayOf(0)) return at.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  if (at.toDateString() === dayOf(1)) return "ayer";
  return at.toLocaleDateString("es", { day: "numeric", month: "short" }).replace(/\./g, "");
}

const FOLDED = "sens.rail.folded";
const folded = () => new Set([].concat(stored(FOLDED, [])));

function keepFold(path, shut) {
  const paths = folded();
  if (shut) paths.add(path);
  else paths.delete(path);
  store(FOLDED, [...paths]);
}

function fault(host, reason) {
  host.querySelector(".fault")?.remove();
  const line = el("p", "none fault", String(reason));
  line.setAttribute("role", "alert");
  host.prepend(line);
}

async function attempt(host, work) {
  host.querySelector(".fault")?.remove();
  try {
    await work();
  } catch (reason) {
    fault(host, reason);
  }
}

function tabStrip(bar, list, key, fallback, picked) {
  const tabs = [...bar.querySelectorAll('[role="tab"]')];
  const ids = tabs.map((tab) => tab.dataset.tab);
  const kept = stored(key, fallback);
  const strip = {
    at: ids.includes(kept) ? kept : fallback,
    paint(count) {
      for (const tab of tabs) {
        const id = tab.dataset.tab;
        tab.setAttribute("aria-selected", String(id === strip.at));
        tab.tabIndex = id === strip.at ? 0 : -1;
        tab.querySelector(".count").textContent = String(count(id));
      }
      list.setAttribute("aria-labelledby", tabs[ids.indexOf(strip.at)].id);
    },
    pick(id) {
      strip.at = id;
      store(key, id);
      picked();
    },
  };

  for (const tab of tabs) tab.addEventListener("click", () => strip.pick(tab.dataset.tab));
  bar.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = tabs[(ids.indexOf(strip.at) + step + tabs.length) % tabs.length];
    strip.pick(next.dataset.tab);
    next.focus();
  });
  return strip;
}

function emptyView(art, lead, said) {
  const box = el("div", "rail-empty view-empty");
  box.innerHTML = art;
  box.append(el("p", "lead", lead), el("p", null, said));
  return box;
}

let spaces = [];
let owed = "";
let showing = "";
let managing = null;
let renaming = "";
const naming = new Set();
const TITLE_LIMIT = 56;

async function paintRail() {
  if (renaming) return;
  try {
    spaces = await invoke("workspaces");
    drawRail();
  } catch (reason) {
    fault(sessionList, reason);
  }
  if (owed) fault(sessionList, owed);
  owed = "";
}

const homeOf = (session) =>
  session === current ? root : spaces.find((space) => space.sessions.some((one) => one.id === session))?.root;

async function nameSession(session) {
  const home = homeOf(session);
  if (!home || naming.has(session)) return;
  naming.add(session);
  const title = await invoke("title_session", { root: home, id: session }).catch(() => null);
  naming.delete(session);
  if (title) await paintRail();
}

function drawRail() {
  if (renaming) return;
  rowMenu.shut();
  const shut = folded();
  sessionList.replaceChildren(
    ...spaces.map((space) => group(space, shut.has(space.root))),
  );
  if (!spaces.length) sessionList.append(emptyRail());
  newBtn.setAttribute("aria-current", String(Boolean(root) && !current && !showing));
  for (const [name, one] of Object.entries(VIEWS)) one.button?.setAttribute("aria-current", String(showing === name));
}

function emptyRail() {
  const pick = el("button");
  pick.innerHTML = ICONS.plus;
  pick.append("Abrir proyecto");
  pick.addEventListener("click", chooseFolder);

  const box = el("div", "rail-empty");
  box.innerHTML = ICONS.folder;
  box.append(el("p", null, "Todavía no hay sesiones."), pick);
  return box;
}

function paintFold(button, list, open) {
  button.setAttribute("aria-expanded", String(open));
  list.dataset.shut = String(!open);
  list.firstElementChild.inert = !open;
}

function group(space, shut) {
  const here = space.root === root;
  const fold = el("button", "fold");
  fold.title = space.root;
  const chev = el("span", "chev");
  chev.innerHTML = ICONS.open;
  fold.append(chev, el("span", "name", space.name));
  if (here) fold.dataset.here = "true";

  const add = el("button", "add");
  add.title = `Sesión nueva en ${space.name}`;
  add.setAttribute("aria-label", add.title);
  add.innerHTML = ICONS.plus;
  add.addEventListener("click", () => draft(space.root));

  const list = el("div", "runs");
  const runs = el("div", "runs-inner");
  const ordered = [...space.sessions].sort((a, b) => Number(a.archived) - Number(b.archived));
  runs.append(...ordered.map((summary) => sessionRow(space.root, summary)));
  if (!space.sessions.length) runs.append(el("p", "none", "Sin sesiones."));
  list.append(runs);

  paintFold(fold, list, !shut);
  fold.addEventListener("click", () => {
    const open = list.dataset.shut === "true";
    keepFold(space.root, !open);
    paintFold(fold, list, open);
  });

  const head = el("div", "project-head");
  head.append(fold, add);
  const node = el("div", "project");
  node.append(head, list);
  return node;
}

function sessionRow(home, summary) {
  const row = el("div", "session-row");
  row.dataset.session = summary.id;
  row.dataset.current = String(!showing && home === root && summary.id === current);

  const open = el("button", "session");
  open.setAttribute("aria-current", row.dataset.current);
  open.title = [
    summary.title,
    `${summary.tasks} ${summary.tasks === 1 ? "mensaje" : "mensajes"}`,
    summary.archived ? "archivada" : "",
  ].filter(Boolean).join(" · ");
  open.append(el("span", "name", summary.title));
  if (summary.archived) {
    const kept = el("span", "kept");
    kept.innerHTML = ICONS.box;
    open.append(kept);
  }
  open.addEventListener("click", () => resume(home, summary.id));

  const dots = el("button", "dots");
  dots.title = "Gestionar sesión";
  dots.setAttribute("aria-label", dots.title);
  dots.setAttribute("aria-haspopup", "menu");
  dots.setAttribute("aria-expanded", "false");
  dots.innerHTML = ICONS.ellipsis;
  dots.addEventListener("click", () => {
    managing = { home, summary };
    rowMenu.toggle(dots);
  });

  row.append(open, dots);
  return row;
}

const unfolded = new Set();
const listings = new Map();
let symbolsOf = new Map();
let drawing = 0;

function listing(path) {
  if (!listings.has(path)) {
    const asked = invoke("folder", { root, path }).catch((reason) => {
      listings.delete(path);
      throw reason;
    });
    listings.set(path, asked);
  }
  return listings.get(path);
}

async function drawFiles() {
  const turn = ++drawing;
  const needle = filterInput.value.trim();
  let rows;
  try {
    rows = !root ? [] : needle ? await foundRows(needle) : await folderRows("", 0);
  } catch (reason) {
    if (turn !== drawing) return;
    fileList.replaceChildren();
    fault(fileList, reason);
    return;
  }
  if (turn !== drawing) return;
  if (!rows.length) rows = [el("p", "none", !root ? "Sin carpeta." : needle ? "Nada coincide." : "Carpeta vacía.")];
  fileList.replaceChildren(...rows);
  paintFiles();
}

async function folderRows(path, depth) {
  const rows = [];
  for (const entry of await listing(path)) {
    rows.push(fileRow(entry, depth));
    if (entry.dir && unfolded.has(entry.path)) rows.push(...(await folderRows(entry.path, depth + 1)));
  }
  return rows;
}

async function foundRows(needle) {
  const found = await invoke("find_files", { root, needle });
  return found.map((entry) => fileRow(entry, 0, true));
}

const parentOf = (path) => path.split("/").slice(0, -1).join("/");

const FILE_KINDS = new Map(
  Object.entries({
    fileJson: "json jsonc json5",
    fileTerminal: "sh bash zsh fish ps1 psm1 psd1 bat cmd",
    fileCog: "toml yaml yml ini cfg conf properties editorconfig gitignore gitattributes npmrc nvmrc prettierrc eslintrc",
    fileText: "md markdown mdx txt log rst adoc pdf doc docx odt rtf",
    fileImage: "png jpg jpeg gif webp avif svg ico bmp tif tiff heic psd",
    fileVideo: "mp4 webm mov mkv avi m4v",
    fileMusic: "mp3 wav ogg flac m4a aac opus mid midi",
    fileArchive: "zip tar gz tgz rar 7z xz bz2 zst",
    fileSheet: "csv tsv xls xlsx ods",
    fileLock: "lock lockb",
    fileKey: "pem key crt cer der pfx p12 pub asc gpg env",
    fileDiff: "diff patch",
    fileType: "ttf otf woff woff2 eot",
    fileBox: "exe dll so dylib wasm jar war deb rpm msi dmg apk nupkg whl bin",
    database: "db sqlite sqlite3 mdb",
  }).flatMap(([kind, extensions]) => extensions.split(" ").map((extension) => [extension, kind])),
);

const NAMED_FILES = {
  dockerfile: "fileBox",
  makefile: "fileTerminal",
  justfile: "fileTerminal",
  procfile: "fileTerminal",
  license: "fileText",
  licence: "fileText",
  "package-lock.json": "fileLock",
  "pnpm-lock.yaml": "fileLock",
};

function glyphOf(name) {
  const lower = name.toLowerCase();
  const extension = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  const tongue = TONGUES[extension] || TONGUES[lower] || "";
  const kind =
    NAMED_FILES[lower] ||
    (/^\.env(\.|$)/.test(lower) ? "fileKey" : FILE_KINDS.get(extension)) ||
    (tongue || TEXTUAL.test(lower) || PAGE.test(lower) ? "fileCode" : "file");
  return { icon: ICONS[kind], tongue };
}

function fileGlyph(name) {
  const { icon: drawn, tongue } = glyphOf(name);
  const glyph = el("span", "glyph");
  glyph.innerHTML = drawn;
  if (tongue) glyph.dataset.tongue = tongue;
  return glyph;
}

function fileRow(entry, depth, found = false) {
  const open = entry.dir && unfolded.has(entry.path);
  const row = el("button", entry.dir ? "filerow folder" : "filerow");
  row.type = "button";
  row.title = entry.path;
  row.dataset.path = entry.path;
  row.style.setProperty("--depth", String(depth));
  if (entry.ignored) row.dataset.ignored = "true";
  if (entry.dir) row.setAttribute("aria-expanded", String(open));

  const glyph = entry.dir ? el("span", "glyph") : fileGlyph(entry.name);
  if (entry.dir) glyph.innerHTML = open ? ICONS.open : ICONS.shut;
  row.append(glyph, el("span", "name", entry.name));
  if (found) row.append(el("span", "dirname", parentOf(entry.path)));
  const count = symbolsOf.get(entry.path);
  if (count) row.append(el("span", "n", String(count)));

  row.addEventListener("click", () => (entry.dir ? fold(entry.path) : view(entry.path)));
  return row;
}

function fold(path) {
  if (unfolded.has(path)) unfolded.delete(path);
  else unfolded.add(path);
  drawFiles();
}

function revealFile(path) {
  const parts = path.split("/");
  let grew = false;
  for (let at = 1; at < parts.length; at++) {
    const folder = parts.slice(0, at).join("/");
    if (unfolded.has(folder)) continue;
    unfolded.add(folder);
    grew = true;
  }
  if (grew) drawFiles();
}

function paintFiles() {
  const hot = [...touched.keys()];
  for (const row of fileList.querySelectorAll(".filerow")) {
    const path = row.dataset.path;
    if (path === opened) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
    const folder = row.classList.contains("folder");
    row.dataset.touched = String(folder ? hot.some((one) => one.startsWith(`${path}/`)) : touched.has(path));
  }
}

const KEYWORDS = new Set(["abstract","as","async","await","break","case","catch","class","const","continue","crate","def","default","delete","do","elif","else","enum","export","extends","extern","false","fn","for","from","func","function","go","if","impl","implements","import","in","instanceof","interface","lambda","let","loop","match","mod","mut","new","nil","null","of","package","pass","pub","raise","return","self","static","struct","super","switch","this","throw","trait","true","try","type","typeof","undefined","use","var","void","where","while","with","yield"]);

const TOKENS = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\/.*$)|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/gm;

function painted(text, hash) {
  const out = document.createDocumentFragment();
  if (hash && /^\s*#/.test(text)) {
    out.append(el("span", "tok-com", text));
    return out;
  }
  let last = 0;
  for (const found of text.matchAll(TOKENS)) {
    const [all, str, com, num, call] = found;
    if (found.index > last) out.append(document.createTextNode(text.slice(last, found.index)));
    if (str) out.append(el("span", "tok-str", all));
    else if (com) out.append(el("span", "tok-com", all));
    else if (num) out.append(el("span", "tok-num", all));
    else if (KEYWORDS.has(all)) out.append(el("span", "tok-key", all));
    else if (call) out.append(el("span", "tok-fn", all));
    else out.append(document.createTextNode(all));
    last = found.index + all.length;
  }
  if (last < text.length) out.append(document.createTextNode(text.slice(last)));
  return out;
}

const HASHED = /\.(py|rb|sh|toml|ya?ml)$/i;

function sourceLines(text, hash, change) {
  const drawn = document.createDocumentFragment();
  text.split("\n").forEach((line, i) => {
    const row = el("div", "line");
    if (change && change.add.has(i + 1)) row.dataset.touched = "add";
    const src = el("span", "src");
    src.append(painted(line, hash));
    row.append(el("span", "num", String(i + 1)), src);
    drawn.append(row);
  });
  return drawn;
}

function showSource(label, drawn, path = "", change = null) {
  opened = path;
  where.textContent = label;
  where.title = label;
  marks.replaceChildren();
  if (change) {
    marks.append(el("span", "plus", `+${change.plus}`), el("span", "minus", `−${change.minus}`));
  }
  sourcePane.replaceChildren(drawn);
  sourcePane.scrollTop = 0;
  paintFiles();
}

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
  pace();
  syncBrowser();
}

let siteUrl = "";
let siteBase = "";
let siteWidth = 0;
let browsing = false;
let browserShown = false;
let browserSpot = "";
let browserFrame = 0;
let viewKind = "";
let page = null;

const PLAIN_HTTP = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[::1\])(:\d+)?([/?#]|$)/i;
const WEBBED = /^https?:\/\//i;
const SCHEMED = /^[a-z][\w+.-]*:\/\//i;
const HOST = /^[\w-]+(\.[\w-]+)+(:\d+)?$/;
const PATHED = /[/\\]/;
const SEARCH = "https://www.google.com/search?q=";

async function showSite(path, home = root) {
  let url;
  try {
    url = await invoke("preview_url", { root: home, path });
  } catch (reason) {
    tick([String(reason)], "warn");
    return;
  }
  const served = new URL(url);
  siteBase = `${served.origin}/${served.pathname.split("/")[1]}/`;
  aimSite(url);
}

function aim(typed) {
  const text = typed.trim();
  if (!text) return;
  if (PLAIN_HTTP.test(text)) return aimSite(`http://${text}`);
  if (WEBBED.test(text)) return aimSite(text);
  if (SCHEMED.test(text)) return tick(["El navegador solo abre direcciones http y https."], "warn");
  const first = text.split(/[/\\?#]/)[0];
  if (HOST.test(first) && !PAGE.test(first)) return aimSite(`https://${text}`);
  if (root && (PAGE.test(text) || PATHED.test(text))) return showSite(text.replace(/^\.?[/\\]/, ""));
  aimSite(`${SEARCH}${encodeURIComponent(text)}`);
}

function addressOf(url) {
  if (!siteBase || !url.startsWith(siteBase)) return url;
  try {
    return decodeURIComponent(url.slice(siteBase.length));
  } catch (ignored) {
    return url;
  }
}

const onProject = () => Boolean(siteBase) && siteUrl.startsWith(siteBase);

async function aimSite(url) {
  siteUrl = url;
  siteUrlInput.value = addressOf(url);
  siteLog.replaceChildren();
  siteConsole.dataset.fault = "false";
  showTool("web");
  const spot = spotOf();
  try {
    await invoke("browser_open", { url, ...spot });
  } catch (reason) {
    warnBrowser(reason);
    return;
  }
  if (!browsing) browserShown = true;
  browsing = true;
  browserSpot = JSON.stringify(spot);
  syncBrowser();
}

function paintSite() {
  siteEmpty.hidden = Boolean(siteUrl);
  siteOut.hidden = !siteUrl;
  siteConsole.hidden = !siteUrl;
  for (const button of [siteBack, siteForward, siteReload]) button.disabled = !siteUrl;
}

function enterSite() {
  paintSite();
  if (!siteUrl) siteUrlInput.focus();
}

function reloadSite() {
  if (browsing) invoke("browser_act", { act: "reload" }).catch(warnBrowser);
}

function warnBrowser(reason) {
  tick([String(reason)], "warn");
}

function spotOf() {
  const box = siteFrame.getBoundingClientRect();
  const narrow = siteWidth > 0 && siteWidth < box.width;
  const width = narrow ? siteWidth : box.width;
  return {
    frame: { x: box.left + (box.width - width) / 2, y: box.top, width, height: box.height },
    zoom: siteWidth > box.width ? box.width / siteWidth : 1,
  };
}

const overlaps = (one, two) => one.left < two.right && one.right > two.left && one.top < two.bottom && one.bottom > two.top;

function covered() {
  if (panel.open) return true;
  const box = siteFrame.getBoundingClientRect();
  return sheets.some(({ sheet }) => !sheet.hidden && overlaps(sheet.getBoundingClientRect(), box));
}

function syncBrowser() {
  if (!browserFrame) browserFrame = requestAnimationFrame(placeBrowser);
}

function placeBrowser() {
  browserFrame = 0;
  if (!browsing) return;
  const shown = panelShows("web") && Boolean(siteUrl) && !covered();
  const spot = spotOf();
  const kept = JSON.stringify(spot);
  if (shown && kept !== browserSpot) {
    browserSpot = kept;
    invoke("browser_place", spot).catch(warnBrowser);
  }
  if (shown === browserShown) return;
  browserShown = shown;
  invoke("browser_show", { shown }).catch(warnBrowser);
}

function hearBrowser(heard) {
  if (heard.kind === "said") return hearConsole(heard.level, heard.text);
  if (heard.kind === "titled") {
    siteUrlInput.title = heard.title;
    return;
  }
  siteUrl = heard.url;
  siteReload.dataset.loading = String(heard.kind === "loading");
  if (document.activeElement !== siteUrlInput) siteUrlInput.value = addressOf(heard.url);
  if (heard.kind !== "loading") return;
  siteLog.replaceChildren();
  siteConsole.dataset.fault = "false";
}

const CONSOLE_CAP = 500;

function hearConsole(level, text) {
  const row = el("p", null, text);
  row.dataset.level = level;
  siteLog.append(row);
  if (siteLog.childElementCount > CONSOLE_CAP) siteLog.firstElementChild.remove();
  siteLog.scrollTop = siteLog.scrollHeight;
  if (level === "error" && siteLog.hidden) siteConsole.dataset.fault = "true";
}

function offer(kind) {
  viewKind = kind;
  codeModes.hidden = !kind;
  mode(kind === "reading" ? "view" : "source");
}

function mode(which) {
  if (which === "view" && viewKind === "site") return showSite(page.path, page.home);
  const reading = which === "view" && viewKind === "reading";
  sourcePane.hidden = reading;
  readingPane.hidden = !reading;
  modeView.setAttribute("aria-pressed", String(reading));
  modeSource.setAttribute("aria-pressed", String(!reading));
}

function present(path, text, change = null, home = root) {
  showSource(path, sourceLines(text, HASHED.test(path), change), path, change);
  page = PAGE.test(path) ? { path, home } : null;
  if (page) return offer("site");
  if (!MARKDOWN.test(path)) return offer("");
  readingPane.replaceChildren(prose(text));
  readingPane.scrollTop = 0;
  offer("reading");
}

function forgetView() {
  if (browsing) invoke("browser_act", { act: "close" }).catch(warnBrowser);
  browsing = false;
  browserShown = false;
  browserSpot = "";
  siteUrl = "";
  siteBase = "";
  siteUrlInput.value = "";
  siteUrlInput.title = "";
  siteLog.replaceChildren();
  siteLog.hidden = true;
  readingPane.replaceChildren();
  page = null;
  offer("");
  paintSite();
}

async function view(path) {
  const stay = opened === path && !sourcePane.hidden;
  revealFile(path);
  let text;
  try {
    text = await invoke("open_file", { root, path });
  } catch (reason) {
    text = String(reason);
  }

  present(path, text, touched.get(path));
  if (stay) mode("source");
  sourcePane.querySelector('[data-touched="add"]')?.scrollIntoView({ block: "center" });
}

function markTouched({ path, lines, plus, minus }) {
  const known = touched.get(path) || { add: new Set(), plus: 0, minus: 0 };
  for (const line of lines) known.add.add(line);
  known.plus += plus;
  known.minus += minus;
  touched.set(path, known);
  paintFiles();
  if (opened === path && panelShows("files")) view(path);
  if (onProject() && panelShows("web")) reloadSite();
  if (panelShows("changes")) soonChanges();
}

function openTouched(path) {
  showTool("files");
  view(path);
}

const CHANGE_PREVIEW = 400;
const CHANGE_CAP = 300;
const CHANGE_WORD = { A: "Nuevo", M: "Modificado", D: "Borrado", R: "Renombrado" };

let changed = null;
let versioned = true;
let changeLap = 0;
let changeSoon = 0;
const unfoldedChanges = new Set();

function diffPath(text) {
  const clean = text.replace(/\t.*$/, "");
  return clean === "/dev/null" ? "" : clean.replace(/^[ab]\//, "");
}

function diffedFile(pair) {
  return { path: pair.slice(2, 2 + Math.floor((pair.length - 5) / 2)), from: "", state: "M", hunks: [], plus: 0, minus: 0, binary: false, fresh: false };
}

const freshFile = (path) => ({ path, from: "", state: "A", hunks: [], plus: 0, minus: 0, binary: false, fresh: true });

function readHeader(file, line) {
  if (line.startsWith("new file")) file.state = "A";
  else if (line.startsWith("deleted file")) file.state = "D";
  else if (line.startsWith("rename from ")) [file.state, file.from] = ["R", line.slice(12)];
  else if (line.startsWith("rename to ")) file.path = line.slice(10);
  else if (line.startsWith("+++ ")) file.path = diffPath(line.slice(4)) || file.path;
  else if (line.startsWith("Binary files")) file.binary = true;
}

function diffedFiles(diff) {
  const found = [];
  let file = null;
  let hunk = null;
  for (const line of diff.split("\n").map((raw) => raw.replace(/\r$/, ""))) {
    if (line.startsWith("diff --git ")) {
      file = diffedFile(line.slice(11));
      found.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    const head = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (head) {
      hunk = { oldStart: Number(head[1]), newStart: Number(head[2]), lines: [] };
      file.hunks.push(hunk);
    } else if (!hunk) {
      readHeader(file, line);
    } else if (/^[ +-]/.test(line)) {
      hunk.lines.push(line);
      if (line[0] === "+") file.plus++;
      if (line[0] === "-") file.minus++;
    }
  }
  return found;
}

async function loadChanges() {
  clearTimeout(changeSoon);
  const lap = ++changeLap;
  const home = root;
  if (!home) return paintChanges();
  let found;
  try {
    found = await invoke("changes", { root: home });
  } catch (reason) {
    if (lap === changeLap) changeList.replaceChildren(el("p", "none fault", String(reason)));
    return;
  }
  if (lap !== changeLap || home !== root) return;
  versioned = Boolean(found);
  changed = found ? [...diffedFiles(found.diff), ...found.fresh.map(freshFile)] : [];
  paintChanges();
}

function soonChanges() {
  clearTimeout(changeSoon);
  changeSoon = setTimeout(loadChanges, 400);
}

function forgetChanges() {
  changed = null;
  versioned = true;
  unfoldedChanges.clear();
  paintChanges();
  if (panelShows("changes")) loadChanges();
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function paintChanges() {
  const files = changed || [];
  changeMarks.replaceChildren();
  if (files.length) {
    const sum = (key) => files.reduce((total, file) => total + file[key], 0);
    changeMarks.append(
      el("span", "files", plural(files.length, "fichero", "ficheros")),
      el("span", "plus", `+${sum("plus")}`),
      el("span", "minus", `−${sum("minus")}`),
    );
  }
  const quiet = !root ? "Sin carpeta." : changed === null ? "Leyendo cambios…" : !versioned ? "Esta carpeta no está en un repositorio git." : !files.length ? "Sin cambios desde el último commit." : "";
  if (quiet) return changeList.replaceChildren(el("p", "none", quiet));
  const rows = files.slice(0, CHANGE_CAP).map(changeRow);
  if (files.length > CHANGE_CAP) rows.push(el("p", "none", `Y ${plural(files.length - CHANGE_CAP, "fichero más", "ficheros más")}.`));
  changeList.replaceChildren(...rows);
}

function countsOf(file) {
  const counts = el("span", "marks");
  if (file.binary) counts.append(el("span", "files", "binario"));
  else if (file.fresh && !file.plus) counts.append(el("span", "plus", "nuevo"));
  else counts.append(el("span", "plus", `+${file.plus}`), el("span", "minus", `−${file.minus}`));
  return counts;
}

function jumpTo(path) {
  const jump = el("button", "jump");
  jump.type = "button";
  jump.title = "Abrir en Ficheros";
  jump.setAttribute("aria-label", jump.title);
  jump.innerHTML = ICONS.fileCode;
  jump.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openTouched(path);
  });
  return jump;
}

function changeRow(file) {
  const node = el("details", "change");
  node.dataset.touched = String(touched.has(file.path));
  const chev = el("span", "chev");
  chev.innerHTML = ICONS.shut;
  const state = el("span", "state", file.state);
  state.dataset.state = file.state;
  state.title = CHANGE_WORD[file.state] || file.state;
  const summary = el("summary");
  summary.title = file.from ? `${file.from} → ${file.path}` : file.path;
  summary.append(chev, state, fileGlyph(file.path), el("span", "name", stem(file.path)), el("span", "dirname", parentOf(file.path)), countsOf(file));
  if (file.state !== "D") summary.append(jumpTo(file.path));
  const inside = el("div", "change-body");
  node.append(summary, inside);
  node.addEventListener("toggle", () => {
    if (node.open) unfoldedChanges.add(file.path);
    else unfoldedChanges.delete(file.path);
    if (node.open && !inside.childElementCount) fillChange(file, inside, summary);
  });
  node.open = unfoldedChanges.has(file.path);
  return node;
}

async function fillChange(file, inside, summary) {
  if (file.binary || (file.fresh && PICTURE.test(file.path))) return inside.replaceChildren(el("p", "none", "Fichero binario."));
  if (file.fresh) {
    let text;
    try {
      text = await invoke("open_file", { root, path: file.path });
    } catch (reason) {
      return inside.replaceChildren(el("p", "none fault", String(reason)));
    }
    const rows = addedRows(text);
    file.plus = rows.length;
    summary.querySelector(".marks").replaceWith(countsOf(file));
    return inside.replaceChildren(linesCard(rows, CHANGE_PREVIEW));
  }
  if (!file.hunks.length) {
    return inside.replaceChildren(el("p", "none", file.state === "R" ? "Renombrado, sin cambios de contenido." : "Sin cambios de contenido."));
  }
  inside.replaceChildren(patchView(file.hunks, CHANGE_PREVIEW).node);
}

const TASK_EVENTS = new Set(["taskStarted", "taskProgress", "taskEnded"]);
const TASK_TOOLS = new Set(["Bash", "PowerShell", "Agent", "Task"]);
const OUTPUT_AT = /written to: (.+?\.output)\b/;
const TASK_STATE = { running: "running", completed: "done", failed: "failed", stopped: "stopped" };

const tasks = new Map();
const taskCalls = new Map();
const taskCards = new Map();
const openTasks = new Set();
let taskClock = 0;

const isShell = (task) => task.runner === "local_bash";
const isAgent = (task) => task.runner.includes("agent");
const isRunning = (task) => task.status === "running";
const runningTasks = () => [...tasks.values()].filter(isRunning).length;

function forgetTasks() {
  tasks.clear();
  taskCalls.clear();
  taskCards.clear();
  openTasks.clear();
  taskList.replaceChildren();
  paintTasks();
}

function startTask(event, at) {
  tasks.set(event.id, {
    id: event.id,
    runner: event.runner,
    description: event.description,
    prompt: event.prompt,
    input: taskCalls.get(event.tool) || {},
    status: "running",
    began: at,
    ended: 0,
    doing: "",
    last: "",
    tools: 0,
    tokens: 0,
    millis: 0,
    summary: "",
    output: "",
  });
}

function endTask(task, event, at) {
  Object.assign(task, {
    status: event.status,
    ended: at,
    summary: event.summary || task.summary,
    output: event.output || task.output,
  });
  if (event.millis) Object.assign(task, { tools: event.tools, tokens: event.tokens, millis: event.millis });
}

function noteTask(event, at = Date.now()) {
  switch (event.kind) {
    case "tool":
      if (TASK_TOOLS.has(event.name)) taskCalls.set(event.id, event.input || {});
      break;
    case "toolDone": {
      const task = tasks.get(event.detail?.backgroundTaskId);
      const path = String(event.output || "").match(OUTPUT_AT)?.[1];
      if (task && path) task.output ||= path;
      break;
    }
    case "taskStarted":
      startTask(event, at);
      break;
    case "taskProgress": {
      const task = tasks.get(event.id);
      if (task) Object.assign(task, { doing: event.doing, last: event.last, tools: event.tools, tokens: event.tokens, millis: event.millis });
      break;
    }
    case "taskEnded": {
      const task = tasks.get(event.id);
      if (task) endTask(task, event, at);
      break;
    }
  }
}

function taskTime(task) {
  if (isRunning(task)) return seconds(whole(Date.now() - task.began));
  if (task.millis) return seconds(task.millis);
  return task.ended > task.began ? seconds(task.ended - task.began) : "";
}

function taskUsage(task) {
  return [
    isRunning(task) && (task.doing || "Trabajando…"),
    task.tools && plural(task.tools, "herramienta", "herramientas"),
    task.tokens && `${compact(task.tokens)} tokens`,
  ].filter(Boolean).join(" · ");
}

function shellEnding(task) {
  if (isRunning(task)) return "";
  if (task.status === "stopped") return "Detenido";
  const code = task.summary.match(/exit code (-?\d+)/)?.[1];
  if (task.status === "failed") return code ? `Terminó con error · código ${code}` : "Terminó con error";
  return code ? `Código de salida ${code}` : "Terminado";
}

function taskCard(task) {
  const node = el("details", "step task");
  const glyph = el("span", "step-icon");
  glyph.innerHTML = isShell(task) ? ICONS.terminal : isAgent(task) ? ICONS.split : ICONS.wrench;
  const title = el("span", "step-target", task.description || task.id);
  title.title = task.description || "";
  const meta = el("span", "step-meta");
  const summary = el("summary");
  summary.append(glyph, el("span", "step-verb", isShell(task) ? "Comando" : isAgent(task) ? "Subagente" : "Tarea"), title, meta, el("span", "step-state"));

  const doing = el("p", "task-doing");
  const said = el("div", "task-said");
  const out = el("pre", "terminal-output");
  const foot = el("div", "terminal-foot");
  const box = terminalView(task.input.command || task.description);
  out.hidden = true;
  box.append(out, foot);
  const told = task.prompt ? [foldedBox(prose(task.prompt), lengthy(task.prompt))] : [];

  const actions = el("div", "task-actions");
  const stop = el("button", "quiet", "Detener");
  stop.type = "button";
  const trouble = el("span", "fault");
  actions.append(stop, trouble);

  const body = el("div", "step-body");
  body.append(...(isShell(task) ? [box] : [...told, doing, said]), actions);
  node.append(summary, body);

  let shownSummary = null;
  let settled = false;
  let reading = false;
  let again = false;

  async function readOutput(path) {
    if (!path) return;
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    try {
      const text = (await invoke("task_output", { path })).replace(/\s+$/, "");
      const stick = out.scrollHeight - out.scrollTop - out.clientHeight < 24;
      out.textContent = text;
      if (stick) out.scrollTop = out.scrollHeight;
    } catch (reason) {
      out.textContent = String(reason);
    } finally {
      reading = false;
      out.hidden = !out.textContent;
    }
    if (again) {
      again = false;
      readOutput(path);
    }
  }

  const card = {
    node,
    update(now) {
      node.dataset.state = TASK_STATE[now.status] || "done";
      meta.textContent = taskTime(now);
      actions.hidden = !isRunning(now);
      if (isShell(now)) {
        box.dataset.state = now.status === "failed" ? "failed" : "done";
        foot.textContent = shellEnding(now);
        foot.hidden = !foot.textContent;
        if (node.open && !settled) {
          settled = !isRunning(now) && Boolean(now.output);
          readOutput(now.output);
        }
        return;
      }
      doing.textContent = taskUsage(now);
      doing.hidden = !doing.textContent;
      if (now.summary === shownSummary) return;
      shownSummary = now.summary;
      said.replaceChildren(...(now.summary ? [prose(now.summary)] : []));
    },
  };

  stop.addEventListener("click", async () => {
    stop.disabled = true;
    trouble.textContent = "";
    try {
      await invoke("chat_stop_task", { sessionId: current, taskId: task.id });
    } catch (reason) {
      trouble.textContent = String(reason);
      stop.disabled = false;
    }
  });
  node.addEventListener("toggle", () => {
    if (node.open) openTasks.add(task.id);
    else openTasks.delete(task.id);
    if (node.open) card.update(tasks.get(task.id));
  });
  node.open = openTasks.has(task.id);
  return card;
}

function paintTasks() {
  const all = [...tasks.values()];
  const running = runningTasks();
  toolBtn.dataset.running = String(running > 0);
  taskTally.textContent = running ? `${running} en marcha` : all.length ? plural(all.length, "tarea", "tareas") : "";
  pace();
  if (!panelShows("tasks")) return;
  if (!all.length) {
    taskList.replaceChildren(el("p", "none", "Aquí verás los subagentes y los comandos que el modelo lance en segundo plano."));
    return;
  }
  taskList.querySelector(":scope > .none")?.remove();
  all.sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || b.began - a.began);
  all.forEach((task, at) => {
    if (!taskCards.has(task.id)) taskCards.set(task.id, taskCard(task));
    const card = taskCards.get(task.id);
    card.update(task);
    if (taskList.children[at] !== card.node) taskList.insertBefore(card.node, taskList.children[at] || null);
  });
}

function pace() {
  const needed = panelShows("tasks") && runningTasks() > 0;
  if (needed && !taskClock) taskClock = setInterval(paintTasks, 1000);
  if (!needed && taskClock) {
    clearInterval(taskClock);
    taskClock = 0;
  }
}

function settleTasks(alive) {
  const live = new Set(alive);
  for (const task of tasks.values()) {
    if (isRunning(task) && !live.has(task.id)) task.status = "stopped";
  }
  paintTasks();
}

const TOOLS = {
  files: { label: "Ficheros", said: "El árbol y el código del proyecto", icon: ICONS.files },
  changes: { label: "Cambios", said: "Lo que difiere del último commit", icon: ICONS.compare, enter: loadChanges, count: () => (repo?.dirty ? String(repo.dirty) : "") },
  web: { label: "Web", said: "Páginas y servidores locales", icon: ICONS.globe, enter: enterSite },
  tasks: { label: "Segundo plano", said: "Subagentes y comandos del modelo", icon: ICONS.activity, enter: paintTasks, count: () => (runningTasks() ? String(runningTasks()) : "") },
};

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

async function loadFiles() {
  listings.clear();
  const indexed = await invoke("tree", { root });
  symbolsOf = new Map(indexed.map((file) => [file.path, file.symbols]));
  await drawFiles();
}

const CLOSING = new Set(["finished", "failed"]);

const HINTS = [
  "Pregunta lo que necesites, pega un error o señálame un fichero.",
  "Cuéntame qué quieres cambiar y empiezo por leer el proyecto.",
  "Pégame una traza y busco de dónde sale.",
  "Pregúntame por un símbolo y te digo quién lo usa.",
  "¿Por dónde empezamos? Describe el problema y lo miro.",
  "Dime un fichero y te lo explico antes de tocarlo.",
  "Empieza por lo que te esté bloqueando ahora mismo.",
  "Pídeme un resumen del proyecto y te lo cuento por dentro.",
];

let lastHint = -1;

function nextHint() {
  let at = lastHint;
  while (HINTS.length > 1 && at === lastHint) at = Math.floor(Math.random() * HINTS.length);
  lastHint = at;
  return HINTS[Math.max(at, 0)];
}

const NO_ROOT = "Elige una carpeta de trabajo para empezar.";

function hello() {
  const box = el("div", "hello");
  const mark = el("div", "hello-mark");
  mark.append(el("span", "hello-word", "sens"));
  box.append(mark, el("p", "hello-hint", root ? nextHint() : NO_ROOT));
  place(box);
  grainient(mark);
  return box;
}

const GRAIN_TOKENS = ["--sens-signal-200", "--sens-signal-500", "--sens-signal-700"];
const GRAIN_VERTEX = `#version 300 es
in vec2 position;
void main() {
gl_Position = vec4(position, 0.0, 1.0);
}`;
const GRAIN_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
out vec4 fragColor;
const float TIME_SPEED = 0.45;
const float WARP_STRENGTH = 2.2;
const float WARP_FREQUENCY = 6.0;
const float WARP_SPEED = 2.6;
const float WARP_AMPLITUDE = 14.0;
const float BLEND_SOFTNESS = 0.04;
const float ROTATION_AMOUNT = 420.0;
const float NOISE_SCALE = 2.0;
const float GRAIN_AMOUNT = 0.12;
const float GRAIN_SCALE = 2.0;
const float CONTRAST = 1.5;
const float ZOOM = 0.55;
#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}
void main(){
float t=iTime*TIME_SPEED;
vec2 uv=gl_FragCoord.xy/iResolution.xy;
float ratio=iResolution.x/iResolution.y;
vec2 tuv=(uv-0.5)/ZOOM;
float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*NOISE_SCALE);
tuv.y*=1.0/ratio;
tuv*=Rot(radians((degree-0.5)*ROTATION_AMOUNT+180.0));
tuv.y*=ratio;
float amplitude=WARP_AMPLITUDE/WARP_STRENGTH;
float warpTime=t*WARP_SPEED;
tuv.x+=sin(tuv.y*WARP_FREQUENCY+warpTime)/amplitude;
tuv.y+=sin(tuv.x*(WARP_FREQUENCY*1.5)+warpTime)/(amplitude*0.5);
float edge0=-0.3-BLEND_SOFTNESS;
float edge1=0.2+BLEND_SOFTNESS;
vec3 layer1=mix(uColor3,uColor2,S(edge0,edge1,tuv.x));
vec3 layer2=mix(uColor2,uColor1,S(edge0,edge1,tuv.x));
vec3 col=mix(layer1,layer2,S(0.5+BLEND_SOFTNESS,-0.3-BLEND_SOFTNESS,tuv.y));
float grain=fract(sin(dot(uv*GRAIN_SCALE,vec2(12.9898,78.233)))*43758.5453);
col+=(grain-0.5)*GRAIN_AMOUNT;
col=clamp((col-0.5)*CONTRAST+0.5,0.0,1.0);
fragColor=vec4(col,1.0);
}`;

function tokenRgb(name) {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim().replace("#", "");
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
}

function shader(gl, kind, source) {
  const made = gl.createShader(kind);
  gl.shaderSource(made, source);
  gl.compileShader(made);
  return gl.getShaderParameter(made, gl.COMPILE_STATUS) ? made : null;
}

function grainProgram(gl) {
  const vertex = shader(gl, gl.VERTEX_SHADER, GRAIN_VERTEX);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, GRAIN_FRAGMENT);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

function grainient(mark) {
  const canvas = el("canvas");
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
  const program = gl && grainProgram(gl);
  if (!program) return;

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  GRAIN_TOKENS.forEach((token, at) => gl.uniform3fv(gl.getUniformLocation(program, `uColor${at + 1}`), tokenRgb(token)));
  const resolution = gl.getUniformLocation(program, "iResolution");
  const clock = gl.getUniformLocation(program, "iTime");

  const fit = () => {
    const box = mark.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(box.width * ratio));
    canvas.height = Math.max(1, Math.round(box.height * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(resolution, canvas.width, canvas.height);
  };
  const watcher = new ResizeObserver(fit);
  watcher.observe(mark);
  mark.prepend(canvas);
  mark.dataset.grain = "on";
  fit();

  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const started = performance.now();
  let shown = false;
  let pending = 0;
  const release = () => {
    watcher.disconnect();
    sight.disconnect();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
  const frame = (now) => {
    pending = 0;
    if (!canvas.isConnected) return release();
    gl.uniform1f(clock, (now - started) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (shown && !still) pending = requestAnimationFrame(frame);
  };
  const sight = new IntersectionObserver(([seen]) => {
    if (!canvas.isConnected) return release();
    shown = seen.isIntersecting;
    if (shown && !pending) pending = requestAnimationFrame(frame);
  });
  sight.observe(mark);
  pending = requestAnimationFrame(frame);
}

let pendingId = null;
let warmed = "";

function blank(id) {
  current = id;
  shownModel = "";
  replyNow = null;
  pendingId = null;
  warmed = "";
  inner.replaceChildren();
  forgetTasks();
}

async function warm() {
  if (!root || busy || !choice.provider) return;
  const settings = currentSettings();
  try {
    const id = current || (await (pendingId ||= invoke("new_session_id")));
    const key = JSON.stringify([root, id, settings]);
    if (key === warmed) return;
    warmed = key;
    await invoke("chat_warm", { root, sessionId: id, settings });
  } catch (ignored) {
    warmed = "";
  }
}

function answeredIn(entries) {
  return new Set(
    entries
      .filter((entry) => entry.kind === "agent" && entry.event.kind === "answered")
      .map((entry) => entry.event.request),
  );
}

async function load(id) {
  blank(id);
  const [entries, running, alive] = await Promise.all([
    invoke("replay", { root, id }),
    invoke("chat_busy", { sessionId: id }),
    invoke("chat_tasks", { sessionId: id }),
  ]);
  const answered = answeredIn(entries);
  let reply = null;
  thread.dataset.replaying = "true";
  requestAnimationFrame(() => requestAnimationFrame(() => delete thread.dataset.replaying));

  for (const entry of entries) {
    if (entry.kind === "task") {
      const pictures = (entry.images || []).map((path) => invoke("artifact_data", { path: inRoot(path) }));
      asked(entry.text, entry.files, pictures);
      reply = null;
      continue;
    }
    if (entry.kind !== "agent") continue;
    const event = entry.event;
    noteTask(event, entry.at);
    if (TASK_EVENTS.has(event.kind)) continue;
    reply ??= opening(event.kind === "started" ? event.model : "");
    const waiting = running && event.kind === "asking" && !answered.has(event.request);
    route(reply, event, waiting);
    if (CLOSING.has(event.kind)) reply = null;
  }

  if (running) {
    replyNow = reply || opening("");
    replyNow.working("Trabajando…");
  }
  settleTasks(alive);
  idle(!running);
  if (!inner.childElementCount) hello();
  await paintRail();
}

function idle(on) {
  busy = !on;
  stopping = false;
  composerBox.dataset.busy = String(busy);
  composerBox.dataset.stopping = "false";
  taskInput.disabled = !root;
  if (busy) reseedLap();
  syncSend();
}

async function enter(picked) {
  root = picked;
  project.setState({ root: picked });
  current = "";
  rootLabel.textContent = stem(picked);
  folderBtn.title = picked;
  touched.clear();
  attached = [];
  paintClips();
  forgetView();
  unfolded.clear();
  showSource("Ningún fichero abierto", el("p", "empty", "Elige un fichero."));
  idle(true);
  if (showing) VIEWS[showing].load();
  await invoke("remember", { root: picked }).catch((reason) => (owed = String(reason)));
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
    fault(sessionList, reason);
  }
}

const draft = (home) => visit(home, async () => {
  keepFold(home, false);
  blank("");
  idle(true);
  hello();
  taskInput.focus();
  await paintRail();
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
  capabilities: { button: capsBtn, node: capsView, icon: ICONS.shapes, load: enterCapabilities },
  artifacts: { button: shelfBtn, node: shelf, icon: ICONS.files, load: loadShelf },
  settings: { button: null, node: settingsView, icon: "", load: enterSettings },
};

function showView(name) {
  showing = name;
  chat.hidden = Boolean(name);
  for (const [id, one] of Object.entries(VIEWS)) one.node.hidden = id !== name;
  drawRail();
  if (name) VIEWS[name].load();
}

function toChat() {
  if (showing) showView("");
}

const SHELF_TAB = "sens.artifacts.tab";
const TEXTUAL = /\.(md|markdown|txt|json|csv|log|js|mjs|cjs|ts|tsx|jsx|rs|py|rb|go|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|ps1|bat|toml|ya?ml|xml|css|scss|sql|lua|vue|svelte|ini|diff|patch)$/i;
const PAGE = /\.html?$/i;
const PICTURE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;
const KIND_ICON = { image: ICONS.image, file: ICONS.fileText, link: ICONS.link };
const KIND_LABEL = { image: "Imagen", file: "Fichero", link: "Enlace" };

const shelfStrip = tabStrip(shelfBar, shelfList, SHELF_TAB, "all", paintShelf);
let shelfItems = [];
const pictures = new Map();
const framed = new WeakMap();

const keeps = (tab, item) => tab === "all" || item.kind === tab;
const here = (item) => item.root === root;
const saying = (needle) => (item) =>
  plain([item.name, item.project, sessionOf(item)].filter(Boolean).join("\n")).includes(needle);
const pictureKey = (item) => `${item.at}:${item.target}`;
const sessionOf = (item) => (item.session ? item.sessionTitle || "Sesión sin título" : "");
const originOf = (item) => [item.project, sessionOf(item)].filter(Boolean).join(" · ");

async function loadShelf() {
  try {
    shelfItems = await invoke("artifacts");
  } catch (reason) {
    shelfItems = [];
    paintShelfSummary();
    shelfList.replaceChildren();
    fault(shelfList, reason);
    return;
  }
  const live = new Set(shelfItems.map(pictureKey));
  for (const key of pictures.keys()) if (!live.has(key)) pictures.delete(key);
  paintShelf();
}

function paintShelfTabs() {
  shelfStrip.paint((id) => shelfItems.filter((item) => keeps(id, item)).length);
}

function paintShelfSummary() {
  paintShelfTabs();
  shelfSeek.hidden = !shelfItems.length;
  shelfProject.textContent = root ? stem(root) : "Sin proyecto";
  shelfProject.title = root;
  shelfTally.textContent = root ? keptTally(shelfItems.filter(here).length) : "Abre un proyecto para ver los suyos.";
}

const keptTally = (kept) => (kept
  ? `${kept} ${kept === 1 ? "artefacto" : "artefactos"} de este proyecto`
  : "Todavía no hay artefactos en este proyecto");

function paintShelf() {
  paintShelfSummary();
  sight.disconnect();
  const kept = shelfItems.filter((item) => keeps(shelfStrip.at, item));
  if (!kept.length) {
    shelfList.replaceChildren(shelfEmpty());
    return;
  }
  const needle = plain(shelfSearch.value.trim());
  const shown = needle ? kept.filter(saying(needle)) : kept;
  if (!shown.length) {
    shelfList.replaceChildren(el("p", "none", "Nada coincide."));
    return;
  }
  shelfList.replaceChildren(shelfStrip.at === "image" ? thumbGrid(shown) : artifactCards(shown));
}

const shelfEmpty = () => emptyView(
  ICONS.shelf,
  "No hay artefactos",
  "Las imágenes, ficheros y enlaces aparecerán aquí según los produzcan las sesiones.",
);

function artifactCards(items) {
  const grid = el("div", "card-grid");
  grid.setAttribute("role", "list");
  grid.append(...items.map(artifactCard));
  return grid;
}

function artifactCard(item) {
  const art = el("span", "card-art");
  art.innerHTML = KIND_ICON[item.kind] || ICONS.fileText;
  const top = el("div", "card-top");
  top.append(art, el("span", "label", KIND_LABEL[item.kind] || "Fichero"));

  const main = el("button", "card-main");
  main.title = item.target;
  main.append(
    el("span", item.kind === "link" ? "name url" : "name", item.name),
    el("span", "sub", item.project),
  );
  main.addEventListener("click", () => openArtifact(item, main));

  const at = el("span", "at", ago(item.at));
  at.title = when(item.at);

  const controls = el("div", "card-controls");
  controls.append(origin(item), at);

  const card = el("div", "card opens");
  card.setAttribute("role", "listitem");
  card.append(top, main, controls);
  return card;
}

function origin(item) {
  const said = sessionOf(item);
  if (!item.session) {
    const none = el("span", "from", "sin sesión");
    none.dataset.empty = "true";
    return none;
  }
  const link = el("button", "from", said);
  link.title = `Abrir la sesión · ${said}`;
  link.addEventListener("click", () => resume(item.root, item.session));
  return link;
}

function thumbGrid(items) {
  const grid = el("div", "thumbs");
  grid.append(...items.map(thumb));
  return grid;
}

function thumb(item) {
  const frame = el("span", "frame");
  frame.innerHTML = ICONS.image;
  framed.set(frame, item);
  sight.observe(frame);

  const node = el("button", "thumb");
  node.setAttribute("aria-label", item.name);
  node.title = [item.name, originOf(item)].filter(Boolean).join(" · ");
  node.append(frame, el("span", "name", item.name));
  node.addEventListener("click", () => openArtifact(item, node));
  return node;
}

function picture(item) {
  const key = pictureKey(item);
  if (!pictures.has(key)) {
    pictures.set(key, invoke("artifact_data", { path: item.target }).catch((reason) => {
      pictures.delete(key);
      throw reason;
    }));
  }
  return pictures.get(key);
}

async function fill(frame) {
  const item = framed.get(frame);
  try {
    const img = el("img");
    img.alt = item.name;
    img.decoding = "async";
    img.src = await picture(item);
    frame.replaceChildren(img);
  } catch (reason) {
    frame.title = String(reason);
  }
}

const sight = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    sight.unobserve(entry.target);
    fill(entry.target);
  }
}, { root: shelf, rootMargin: "200px" });

const readText = (item) => invoke("artifact_text", { path: item.target });
const launch = (item) => invoke("open_external", { target: item.target });

async function showPicture(item, back) {
  const img = el("img", "sight");
  img.alt = item.name;
  img.src = await picture(item);
  preview(item.name, back, img);
}

async function showText(item) {
  present(item.target, await readText(item), null, item.root);
  if (PAGE.test(item.name)) return showSite(item.target, item.root);
  showTool("files");
}

function opener(item) {
  if (item.kind === "image") return showPicture;
  if (item.kind === "link") return launch;
  if (PAGE.test(item.name) || TEXTUAL.test(item.name)) return showText;
  return launch;
}

function openArtifact(item, back) {
  return attempt(shelfList, () => opener(item)(item, back));
}

const MD_FENCE = /^\s*(`{3,}|~{3,})\s*([\w#+.-]*)/;
const MD_HEAD = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const MD_ITEM = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const MD_INLINE = /(`+)(.+?)\1|\*\*(.+?)\*\*|__(.+?)__|\*(?!\s)(.+?)\*|(?<!\w)_(?!\s)(.+?)_(?!\w)|!?\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g;
const WEB = /^https?:\/\//i;
const HASH_LANGUAGES = new Set(["py", "python", "sh", "bash", "shell", "zsh", "ps1", "powershell", "pwsh", "toml", "yaml", "yml", "rb", "ruby", "dockerfile", "makefile"]);
const CODE_FOLD = 30;
const TONGUES = {
  js: "amber", mjs: "amber", cjs: "amber", jsx: "amber", json: "amber",
  zig: "amber", jsonc: "amber", json5: "amber",
  ts: "azure", tsx: "azure", mts: "azure", cts: "azure", css: "azure", scss: "azure", sass: "azure", less: "azure",
  vue: "azure", svelte: "azure", c: "azure", h: "azure", cc: "azure", cpp: "azure", hpp: "azure", cxx: "azure",
  lua: "azure", dart: "azure", r: "azure",
  rs: "ember", rust: "ember", toml: "ember", sh: "ember", bash: "ember", zsh: "ember", fish: "ember",
  shell: "ember", ps1: "ember", psm1: "ember", powershell: "ember", pwsh: "ember", bat: "ember", cmd: "ember",
  java: "ember", swift: "ember", scala: "ember", erl: "ember",
  py: "moss", python: "moss", pyi: "moss", ipynb: "moss", go: "moss", sql: "moss", rb: "moss", ruby: "moss",
  clj: "moss", csv: "moss", tsv: "moss",
  html: "iris", htm: "iris", md: "iris", markdown: "iris", mdx: "iris", yaml: "iris", yml: "iris", xml: "iris", svg: "iris",
  php: "iris", cs: "iris", kt: "iris", kts: "iris", ex: "iris", exs: "iris", hs: "iris", graphql: "iris", gql: "iris",
  diff: "stone", patch: "stone", txt: "stone", log: "stone", ini: "stone", cfg: "stone", conf: "stone", env: "stone",
  dockerfile: "stone", proto: "stone", lock: "stone",
};

function spell(tag, text) {
  const node = el(tag);
  node.append(inline(text));
  return node;
}

function outward(target) {
  invoke("open_external", { target }).catch((reason) => tick([String(reason)], "warn"));
}

function linked(label, url) {
  if (!WEB.test(url)) return inline(label);
  const link = el("a");
  link.href = url;
  link.title = url;
  link.append(inline(label || url));
  link.addEventListener("click", (event) => {
    event.preventDefault();
    outward(url);
  });
  return link;
}

function inline(text) {
  const out = document.createDocumentFragment();
  let last = 0;
  for (const found of text.matchAll(MD_INLINE)) {
    const [all, , code, strong, underStrong, em, underEm, label, url] = found;
    out.append(text.slice(last, found.index));
    if (code !== undefined) out.append(el("code", null, code));
    else if (strong !== undefined || underStrong !== undefined) out.append(spell("strong", strong ?? underStrong));
    else if (em !== undefined || underEm !== undefined) out.append(spell("em", em ?? underEm));
    else out.append(linked(label, url));
    last = found.index + all.length;
  }
  out.append(text.slice(last));
  return out;
}

function copyButton(text) {
  const copy = el("button", "copy");
  copy.type = "button";
  copy.title = "Copiar";
  copy.setAttribute("aria-label", copy.title);
  copy.innerHTML = ICONS.copy;
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.innerHTML = ICONS.check;
      setTimeout(() => (copy.innerHTML = ICONS.copy), 1500);
    } catch (reason) {
      copy.title = String(reason);
    }
  });
  return copy;
}

function unfolder(box, label) {
  const unfold = el("button", "unfold", label);
  unfold.type = "button";
  unfold.addEventListener("click", () => {
    box.dataset.folded = "false";
    unfold.remove();
  });
  return unfold;
}

function codeBlock(text, language = "") {
  const hash = HASH_LANGUAGES.has(language.toLowerCase());
  const code = el("code");
  text.split("\n").forEach((line, at) => {
    if (at) code.append("\n");
    code.append(painted(line, hash));
  });
  const pre = el("pre");
  pre.append(code);

  const head = el("div", "codeblock-head");
  head.append(el("span", "tongue"), el("span", null, language || "código"), copyButton(text));

  const box = el("div", "codeblock");
  const tongue = TONGUES[language.toLowerCase()];
  if (tongue) box.dataset.tongue = tongue;
  box.append(head, pre);
  const lines = text.split("\n").length;
  if (lines > CODE_FOLD) {
    box.dataset.folded = "true";
    box.append(unfolder(box, `Mostrar las ${lines} líneas`));
  }
  return box;
}

const LONG_TEXT = 900;
const LONG_LINES = 12;

const lengthy = (text) => text.length > LONG_TEXT || text.split("\n").length > LONG_LINES;

function foldedBox(node, long) {
  const inside = el("div", "inside");
  inside.append(node);
  const box = el("div", "folded");
  box.append(inside);
  if (long) {
    box.dataset.folded = "true";
    box.append(unfolder(box, "Mostrar todo"));
  }
  return box;
}

const MD_ROW = /^\s*\|.*\|\s*$/;
const MD_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const MD_BREAK = /^\s*([-*_])(\s*\1){2,}\s*$/;
const MD_QUOTE = /^\s*>\s?(.*)$/;

const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

function tableOf(rows) {
  const table = el("table");
  const head = table.createTHead().insertRow();
  for (const cell of cells(rows[0])) head.append(spell("th", cell));
  const body = table.createTBody();
  for (const row of rows.slice(2)) {
    const line = body.insertRow();
    for (const cell of cells(row)) line.append(spell("td", cell));
  }
  const box = el("div", "table");
  box.append(table);
  return box;
}

function listInto(lists, page, item) {
  const [, indent, bullet, number, text] = item;
  const depth = indent.replace(/\t/g, "    ").length;
  const tag = bullet ? "UL" : "OL";
  while (lists.length && depth < lists.at(-1).depth) lists.pop();

  let top = lists.at(-1);
  if (!top || depth > top.depth || top.list.tagName !== tag) {
    const list = el(tag);
    if (number) list.start = Number(number);
    const deeper = top && depth > top.depth;
    if (top && !deeper) lists.pop();
    const parent = deeper ? top.list.lastElementChild : lists.at(-1)?.list.lastElementChild || page;
    parent.append(list);
    top = { depth, list };
    lists.push(top);
  }
  top.list.append(spell("li", text));
}

function prose(text) {
  const page = el("div", "prose");
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let words = [];
  let lists = [];

  const paragraph = () => {
    if (words.length) page.append(spell("p", words.join(" ")));
    words = [];
  };
  const settle = () => {
    paragraph();
    lists = [];
  };

  for (let at = 0; at < lines.length; at++) {
    const line = lines[at];
    const fence = line.match(MD_FENCE);
    if (fence) {
      settle();
      const code = [];
      while (++at < lines.length && !lines[at].trim().startsWith(fence[1])) code.push(lines[at]);
      page.append(codeBlock(code.join("\n"), fence[2]));
      continue;
    }
    const head = line.match(MD_HEAD);
    if (head) {
      settle();
      page.append(spell(`h${head[1].length}`, head[2]));
      continue;
    }
    if (MD_ROW.test(line) && MD_RULE.test(lines[at + 1] || "")) {
      settle();
      const rows = [line, lines[++at]];
      while (MD_ROW.test(lines[at + 1] || "")) rows.push(lines[++at]);
      page.append(tableOf(rows));
      continue;
    }
    if (MD_BREAK.test(line)) {
      settle();
      page.append(el("hr"));
      continue;
    }
    const quote = line.match(MD_QUOTE);
    if (quote) {
      settle();
      const said = [quote[1]];
      while (MD_QUOTE.test(lines[at + 1] || "")) said.push(lines[++at].match(MD_QUOTE)[1]);
      page.append(spell("blockquote", said.join(" ")));
      continue;
    }
    const item = line.match(MD_ITEM);
    if (item) {
      paragraph();
      listInto(lists, page, item);
      continue;
    }
    if (!line.trim()) {
      paragraph();
      continue;
    }
    if (lists.length && /^\s+\S/.test(line)) {
      lists.at(-1).list.lastElementChild.append(" ", inline(line.trim()));
      continue;
    }
    lists = [];
    words.push(line.trim());
  }
  settle();
  return page;
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
    tick([String(reason)], "warn");
    return;
  }
  for (const item of found.items) {
    if (item.kind === "picture") {
      pasted.push({ name: item.name, bytes: item.bytes, mediaType: item.mediaType, url: `data:${item.mediaType};base64,${item.data}` });
    } else if (!attached.some((file) => file.path === item.path)) {
      attached.push(item);
    }
  }
  for (const reason of found.refused) tick([reason], "warn");
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
      tick([`${name} no se puede enviar · solo PNG, JPEG, GIF o WebP`], "warn");
      continue;
    }
    if (file.size > PICTURE_CAP) {
      tick([`${name} pasa de 5 MB · redúcela antes de enviarla`], "warn");
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
    tick([String(reason)], "warn");
    return;
  }
  paintChip();
  tick(["rama · ", bold(repo.branch)]);
  touched.clear();
  forgetChanges();
  await loadFiles();
  if (opened) await view(opened);
}

const canSend = () => Boolean(root && choice.provider && (taskInput.value.trim() || pasted.length));

function syncSend() {
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

async function halt() {
  if (stopping || !current) return;
  stopping = true;
  composerBox.dataset.stopping = "true";
  syncSend();
  replyNow?.working("Parando…");
  try {
    await invoke("chat_stop", { sessionId: current });
  } catch (reason) {
    tick([String(reason)], "warn");
    stopping = false;
    composerBox.dataset.stopping = "false";
    syncSend();
  }
}

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
  if (busy || !canSend()) return;
  const text = taskInput.value.trim();
  const files = attached.map((file) => file.path);
  const shownFiles = attached.map(fileLabel);
  const pictures = pasted.map((picture) => picture.url);
  const images = pasted.map((picture) => ({
    mediaType: picture.mediaType,
    data: picture.url.slice(picture.url.indexOf(",") + 1),
  }));
  const settings = currentSettings();
  taskInput.value = "";
  fit();
  attached = [];
  pasted = [];
  paintClips();
  asked(text, shownFiles, pictures);
  replyNow = opening(settings.model);
  replyNow.working("Enviando…");
  idle(false);

  try {
    if (!current) current = await invoke("open_session", { root, id: pendingId ? await pendingId : null });
    pendingId = null;
    await invoke("chat_send", { root, sessionId: current, message: { text, files, images }, settings });
    paintRail();
  } catch (reason) {
    replyNow?.failed(String(reason));
    replyNow = null;
    idle(true);
  }
}

folderBtn.addEventListener("click", chooseFolder);
newBtn.querySelector(".nav-icon").innerHTML = ICONS.pen;
newBtn.addEventListener("click", fresh);
for (const [name, one] of Object.entries(VIEWS)) {
  if (!one.button) continue;
  one.button.querySelector(".nav-icon").innerHTML = one.icon;
  one.button.addEventListener("click", () => showView(name));
}

siteReload.insertAdjacentHTML("afterbegin", ICONS.refresh);
siteConsole.insertAdjacentHTML("afterbegin", ICONS.terminal);
siteReload.addEventListener("click", reloadSite);
modeSource.addEventListener("click", () => mode("source"));
modeView.addEventListener("click", () => mode("view"));
siteConsole.addEventListener("click", () => {
  siteLog.hidden = !siteLog.hidden;
  siteConsole.setAttribute("aria-pressed", String(!siteLog.hidden));
  if (!siteLog.hidden) siteConsole.dataset.fault = "false";
});
siteWidths.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const wide = Number(button.dataset.width);
  for (const other of siteWidths.children) other.setAttribute("aria-pressed", String(other === button));
  siteWidth = wide;
  syncBrowser();
});
siteBack.insertAdjacentHTML("afterbegin", ICONS.back);
siteForward.insertAdjacentHTML("afterbegin", ICONS.forward);
siteBack.addEventListener("click", () => invoke("browser_act", { act: "back" }).catch(warnBrowser));
siteForward.addEventListener("click", () => invoke("browser_act", { act: "forward" }).catch(warnBrowser));
listen("browser", ({ payload }) => hearBrowser(payload));
new ResizeObserver(syncBrowser).observe(siteFrame);
addEventListener("resize", syncBrowser);
panel.addEventListener("close", syncBrowser);
shelfSeek.insertAdjacentHTML("afterbegin", ICONS.search);
shelfSearch.addEventListener("input", paintShelf);
shelfFoot.insertAdjacentHTML("afterbegin", ICONS.shieldCheck);

for (const shut of codePanel.querySelectorAll(".shut-tool")) {
  shut.innerHTML = ICONS.close;
  shut.addEventListener("click", closeTools);
}
changesReload.innerHTML = ICONS.refresh;
changesReload.addEventListener("click", loadChanges);
siteAddress.insertAdjacentHTML("afterbegin", ICONS.globe);
siteAddress.addEventListener("submit", (event) => {
  event.preventDefault();
  siteUrlInput.blur();
  aim(siteUrlInput.value);
});
siteOut.innerHTML = ICONS.external;
siteOut.addEventListener("click", () => outward(siteUrl));
document.getElementById("toggle-tree").addEventListener("click", (event) => {
  const shown = codeBody.dataset.tree !== "hidden";
  codeBody.dataset.tree = shown ? "hidden" : "shown";
  event.currentTarget.setAttribute("aria-pressed", String(!shown));
});

let seeking = 0;
filterInput.addEventListener("input", () => {
  clearTimeout(seeking);
  seeking = setTimeout(drawFiles, 120);
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

function anchorMenu(menu, anchor) {
  menu.hidden = false;
  menu.style.visibility = "hidden";
  const at = anchor.getBoundingClientRect();
  const size = menu.getBoundingClientRect();
  const edge = 12;
  const below = at.bottom + 6;
  const fits = below + size.height <= window.innerHeight - edge;
  menu.style.top = `${fits ? below : Math.max(edge, at.top - 6 - size.height)}px`;
  menu.style.left = `${Math.min(Math.max(edge, at.right - size.width), window.innerWidth - size.width - edge)}px`;
  menu.style.visibility = "";
}

function paintRowMenu() {
  const [rename, keep, drop] = rowMenu.sheet.querySelectorAll(".menu-item");
  rename.querySelector(".act-icon").innerHTML = ICONS.pencil;
  const kept = managing?.summary.archived;
  keep.querySelector(".act-icon").innerHTML = kept ? ICONS.unarchive : ICONS.archive;
  keep.querySelector(".act-text").textContent = kept ? "Desarchivar" : "Archivar";
  drop.dataset.armed = "false";
  drop.querySelector(".act-icon").innerHTML = ICONS.trash;
  drop.querySelector(".act-text").textContent = "Eliminar";
  anchorMenu(rowMenu.sheet, rowMenu.anchor);
}

const rowMenu = steer(popover(document.getElementById("session-menu"), null, paintRowMenu));
const toolSheet = steer(popover(toolMenu, toolBtn, paintToolMenu));

const backToRow = (id) =>
  (sessionList.querySelector(`.session-row[data-session="${id}"] .dots`) || newBtn).focus();

rowMenu.sheet.querySelector('[data-act="rename"]').addEventListener("click", () => {
  const { home, summary } = managing;
  rowMenu.shut();
  renameRow(home, summary);
});

function renameRow(home, summary) {
  const row = sessionList.querySelector(`.session-row[data-session="${summary.id}"]`);
  if (!row) return;
  const field = el("input", "field rename");
  field.value = summary.title;
  field.maxLength = TITLE_LIMIT;
  field.spellcheck = false;
  field.autocomplete = "off";
  field.setAttribute("aria-label", "Nombre de la sesión");
  renaming = summary.id;
  row.dataset.renaming = "true";
  row.prepend(field);
  field.focus();
  field.select();

  let settled = false;
  const settle = async (keep) => {
    if (settled) return;
    settled = true;
    const title = field.value.trim();
    const changed = keep && title && title !== summary.title;
    try {
      if (changed) await invoke("rename_session", { root: home, id: summary.id, title });
    } catch (reason) {
      owed = String(reason);
    }
    renaming = "";
    await paintRail();
    backToRow(summary.id);
  };

  field.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    settle(event.key === "Enter");
  });
  field.addEventListener("blur", () => {
    if (document.hasFocus()) settle(true);
  });
}

rowMenu.sheet.querySelector('[data-act="archive"]').addEventListener("click", () => {
  const { home, summary } = managing;
  rowMenu.shut();
  attempt(sessionList, async () => {
    await invoke("archive_session", { root: home, id: summary.id, archived: !summary.archived });
    await paintRail();
    backToRow(summary.id);
  });
});

rowMenu.sheet.querySelector('[data-act="erase"]').addEventListener("click", (event) => {
  const item = event.currentTarget;
  if (item.dataset.armed !== "true") {
    item.dataset.armed = "true";
    item.querySelector(".act-text").textContent = "Confirmar";
    return;
  }
  const { home, summary } = managing;
  rowMenu.shut();
  attempt(sessionList, async () => {
    await invoke("delete_session", { root: home, id: summary.id });
    if (home === root && summary.id === current) return draft(home);
    await paintRail();
    backToRow(summary.id);
  });
});

sessionList.addEventListener("scroll", () => rowMenu.shut(), { passive: true });

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

const initials = (name) =>
  name.split(/\s+/).slice(0, 2).map((word) => [...word][0]).join("").toUpperCase();

function paintPerson({ person, fault: failed }) {
  if (failed) {
    fault(foot, failed);
    return;
  }
  foot.querySelector(".fault")?.remove();
  const name = (person.name || "").trim();
  if (name) avatar.textContent = initials(name);
  else avatar.innerHTML = ICONS.user;
  profileName.textContent = name || "Sin nombre";
  profileName.dataset.empty = String(!name);
}

profile.subscribe(paintPerson);

let panelBack = profileBtn;

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

const UPDATE_STAGES = {
  downloading: "Descargando…",
  verifying: "Verificando la firma…",
  installing: "Instalando: Sens se cerrará y volverá a abrirse",
};
const updateBtn = document.getElementById("update");

function say(line, text, failed = false) {
  line.textContent = String(text);
  line.classList.toggle("fault", failed);
  line.hidden = !line.textContent;
}

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

function openUpdate(back) {
  const { current, latest: next, installable } = updates.getState();
  if (!next) return;
  const facts = el("p", "note", [current && `Tienes la ${current}`, weigh(next.size)].filter(Boolean).join(" · "));
  const notes = next.notes.trim() ? prose(next.notes) : el("p", "note", "Esta versión no trae notas.");
  notes.classList.add("update-notes");
  const status = el("p", "note");
  status.id = "update-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  const page = el("button", "quiet");
  page.innerHTML = ICONS.external;
  page.append(el("span", null, "Ver en GitHub"));
  page.addEventListener("click", () => invoke("open_external", { target: next.page }).catch((reason) => say(status, reason, true)));
  const later = el("button", "quiet", "Más tarde");
  later.addEventListener("click", () => panel.close());
  const go = el("button", "primary", "Actualizar y reiniciar");
  go.disabled = !installable;
  go.addEventListener("click", () => installUpdate(go, status));
  if (!installable) say(status, "Build de desarrollo: comprueba pero no instala.");
  const actions = el("div", "actions update-actions");
  actions.append(page, later, go);
  panelBack = back;
  showPanel(`Sens ${next.version}`, facts, notes, status, actions);
}

async function installUpdate(button, status) {
  if (button.dataset.sure !== "true") {
    const working = await invoke("chat_working").catch(() => 0);
    if (working > 0) {
      button.dataset.sure = "true";
      button.textContent = "Actualizar igualmente";
      button.classList.add("danger");
      say(status, working === 1 ? "Hay 1 sesión trabajando y se detendrá." : `Hay ${working} sesiones trabajando y se detendrán.`);
      return;
    }
  }
  button.disabled = true;
  say(status, UPDATE_STAGES.downloading);
  try {
    await invoke("update_install");
  } catch (reason) {
    say(status, reason, true);
    button.dataset.sure = "false";
    button.classList.remove("danger");
    button.textContent = "Reintentar";
    button.disabled = false;
  }
}

updateBtn.addEventListener("click", () => openUpdate(updateBtn));
listen("update", ({ payload }) => {
  const status = document.getElementById("update-status");
  if (status) say(status, UPDATE_STAGES[payload.stage]);
});

const SHORTCUTS = [
  ["Enter", "Enviar"],
  ["Mayús+Enter", "Nueva línea"],
  ["Ctrl+V", "Pegar una imagen en el mensaje"],
  ["Ctrl+B", "Mostrar u ocultar la barra lateral"],
  ["Ctrl+N", "Sesión nueva"],
  ["Ctrl+O", "Abrir carpeta"],
  ["Esc", "Cerrar"],
];

function openKeys() {
  const table = el("table", "keys");
  for (const [keys, does] of SHORTCUTS) {
    const row = table.insertRow();
    row.insertCell().append(el("kbd", null, keys));
    row.insertCell().textContent = does;
  }
  showPanel("Atajos de teclado", table);
}

async function openAbout() {
  const version = el("span", "mono");
  const name = el("p", "about");
  name.append(el("b", null, "sens"), version);
  showPanel("Acerca de Sens", name, el("p", "mono selectable", "github.com/iiTzSenn/Sens"));
  try {
    version.textContent = await getVersion();
  } catch (reason) {
    version.className = "fault";
    version.textContent = String(reason);
  }
}

const PANELS = { settings: () => showView("settings"), keys: openKeys, about: openAbout };
const menuSheet = steer(popover(menu, profileBtn));

for (const item of menu.querySelectorAll("[data-panel]")) {
  item.addEventListener("click", () => {
    menuSheet.shut();
    PANELS[item.dataset.panel]();
  });
}

document.getElementById("panel-close").addEventListener("click", () => panel.close());
panel.addEventListener("click", (event) => {
  if (event.target === panel) panel.close();
});
panel.addEventListener("close", () => {
  panel.dataset.wide = "false";
  panelBody.replaceChildren();
  if (panelBack.isConnected) panelBack.focus();
  panelBack = profileBtn;
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
sendBtn.addEventListener("click", () => (busy ? halt() : send()));
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

async function afterTurn() {
  idle(true);
  if (showing === "artifacts") loadShelf();
  await readRepo();
  if (panelShows("changes")) await loadChanges();
  await loadFiles();
  await paintRail();
}

function hear(event) {
  replyNow ??= opening("");
  route(replyNow, event, true);
  if (!CLOSING.has(event.kind)) return;
  replyNow = null;
  afterTurn();
}

listen("chat", ({ payload }) => {
  const { session, event } = payload;
  if (event.kind === "limits") {
    usage = event.windows;
    paintAccount();
    return;
  }
  if (CLOSING.has(event.kind)) nameSession(session);
  if (session !== current) {
    if (CLOSING.has(event.kind)) paintRail();
    return;
  }
  noteTask(event);
  if (TASK_EVENTS.has(event.kind)) return paintTasks();
  hear(event);
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
    owed = String(reason);
  }
  await paintRail();
}

Object.assign(legacy, {
  openUpdate,
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
  syncBrowser,
  prose,
  showSource,
  showTool,
  outward,
});

hello();
paintKnobs();
paintClips();
syncSend();
loadCatalog();
syncFrame();
loadProfile().then(startUpdates);
boot();
