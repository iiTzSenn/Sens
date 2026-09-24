import { createStore } from "zustand/vanilla";
import { commands, events } from "../../ipc/commands";
import type { AgentEvent, ChatEvent, Decision, Message, SessionEntry, Settings } from "../../ipc/types";
import { legacy } from "../../legacy/bridge";
import { loadShelf } from "../artifacts/store";
import { loadChanges, soonChanges } from "../changes/store";
import { loadFiles } from "../files/store";
import { openFile, viewer } from "../files/view";
import { noteEdit, project } from "../project/store";
import { loadRail, nameSession } from "../rail/store";
import { forgetTasks, noteTask, settleTasks } from "../tasks/store";
import { TASK_EVENTS } from "../tasks/tasks";
import { onProject, reloadSite } from "../web/store";
import { SILENT, consulting, editOf, statusOf } from "./looks";
import { CLOSING, answered, heard, nextKey, opening, type Picture, type Piece, type Reply, type Turn } from "./turns";

// The chat of the session on screen: its turns; whether Claude is working
// (`busy`) and being stopped; the hint the empty chat shows; and whether a
// session is being drawn back, which skips the entry animations.
export const chat = createStore(() => ({
  turns: [] as Turn[],
  busy: false,
  stopping: false,
  hint: "",
  replaying: false,
}));

const set = chat.setState;

// The reply the live events go to, if one is open.
let replying: number | null = null;
// The model named last in this chat: a reply names its model only when it changes.
let named = "";
// A new session's id, asked for before its first message so it can warm up.
let pendingId: Promise<string> | null = null;
let warmed = "";

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
const NO_ROOT = "Elige una carpeta de trabajo para empezar.";

let lastHint = -1;

function nextHint() {
  let at = lastHint;
  while (HINTS.length > 1 && at === lastHint) at = Math.floor(Math.random() * HINTS.length);
  lastHint = at;
  return HINTS[Math.max(at, 0)];
}

const session = () => project.getState().session;
const setSession = (id: string) => project.setState({ session: id });

// The empty chat invites to start, or to pick a folder first.
export const hello = () => set({ hint: project.getState().root ? nextHint() : NO_ROOT });

export function notice(parts: Piece[], tone: "" | "warn" = "") {
  set(({ turns }) => ({ turns: [...turns, { kind: "notice", key: nextKey(), parts, tone }] }));
}

export const warn = (text: string) => notice([text], "warn");

function onReply(key: number | null, change: (reply: Reply) => Reply) {
  if (key === null) return;
  set(({ turns }) => ({ turns: turns.map((turn) => (turn.kind === "reply" && turn.key === key ? change(turn) : turn)) }));
}

// A new reply, named after its model when the model changed since the last.
function open(model: string) {
  const reply = opening(nameOf(model));
  set(({ turns }) => ({ turns: [...turns, reply] }));
  return reply.key;
}

function nameOf(model: string) {
  if (!model) return "";
  const said = legacy.modelName(model);
  if (said === named) return "";
  const first = !named;
  named = said;
  return first ? "" : said;
}

export function idle(on: boolean) {
  set({ busy: !on, stopping: false });
}

// A new session, empty: it gets its id once the first message goes.
export function blank(id: string) {
  setSession(id);
  named = "";
  replying = null;
  pendingId = null;
  warmed = "";
  set({ turns: [] });
  forgetTasks();
}

// The agent changed a file: the tree and the viewer mark it, and what shows it
// (the file, the page, the changes) reads it again.
function touched(edit: { path: string; lines: number[]; plus: number; minus: number }) {
  noteEdit(edit);
  if (viewer.getState().opened === edit.path) openFile(edit.path);
  if (onProject() && legacy.panelShows("web")) reloadSite();
  if (legacy.panelShows("changes")) soonChanges();
}

// One event on the reply it goes to, and what the live line says of it.
function route(key: number, event: ChatEvent, live: boolean) {
  onReply(key, (reply) => heard(reply, event, live));
  if (event.kind === "started") {
    const who = nameOf(event.model);
    if (who) onReply(key, (reply) => ({ ...reply, who }));
  }
  if (event.kind === "toolDone") {
    const step = chat.getState().turns.flatMap((turn) => (turn.kind === "reply" ? turn.parts : [])).find((part) => part.kind === "step" && part.id === event.id);
    const edit = step?.kind === "step" ? editOf(step.name, step.input, event.detail) : null;
    if (edit?.path && !event.error) touched({ path: edit.path, lines: edit.added, plus: edit.plus, minus: edit.minus });
  }
  if (!live) return;
  const said = working(event);
  if (said) onReply(key, (reply) => (reply.closed ? reply : { ...reply, working: said }));
}

function working(event: ChatEvent) {
  switch (event.kind) {
    case "started":
      return "Trabajando…";
    case "delta":
      return event.thinking ? "Razonando…" : "Escribiendo…";
    case "tool":
      return SILENT.has(event.name) ? "" : statusOf(event.name, event.input || {});
    case "consulted":
      return consulting(event.links);
    case "asking":
      return "Esperando tu respuesta";
    default:
      return "";
  }
}

const inRoot = (path: string) => `${project.getState().root.replace(/[\\/]+$/, "")}/${path}`;

// A saved session drawn back as it went. A question still waiting when the
// session is still running can be answered.
export async function load(id: string) {
  blank(id);
  const { root } = project.getState();
  const [entries, running, alive] = await Promise.all([commands.replay(root, id), commands.chatBusy(id), commands.chatTasks(id)]);
  const answeredOnes = new Set(entries.flatMap((entry) => (entry.kind === "agent" && entry.event.kind === "answered" ? [entry.event.request] : [])));

  set({ replaying: true });
  requestAnimationFrame(() => requestAnimationFrame(() => set({ replaying: false })));

  let reply: number | null = null;
  for (const entry of entries as SessionEntry[]) {
    if (entry.kind === "task") {
      asked(entry.text, entry.files, (entry.images || []).map((path) => commands.artifactData(inRoot(path))));
      reply = null;
      continue;
    }
    if (entry.kind !== "agent") continue;
    const event = entry.event;
    noteTask(event as AgentEvent, entry.at);
    if (TASK_EVENTS.has(event.kind)) continue;
    reply ??= open(event.kind === "started" ? event.model : "");
    const waiting = running && event.kind === "asking" && !answeredOnes.has(event.request);
    route(reply, event, waiting);
    if (CLOSING.has(event.kind)) reply = null;
  }

  if (running) {
    replying = reply ?? open("");
    onReply(replying, (open) => ({ ...open, working: "Trabajando…" }));
  }
  settleTasks(alive);
  idle(!running);
  if (!chat.getState().turns.length) hello();
  await loadRail();
}

function asked(text: string, files: string[], pictures: Picture[]) {
  set(({ turns }) => ({ turns: [...turns, { kind: "you", key: nextKey(), text, files, pictures }] }));
}

// A message as the composer hands it: what to send, and how it shows.
export interface Outgoing {
  message: Message;
  shownFiles: string[];
  pictures: string[];
}

export async function send({ message, shownFiles, pictures }: Outgoing, settings: Settings) {
  const { root } = project.getState();
  asked(message.text, shownFiles, pictures);
  replying = open(settings.model);
  onReply(replying, (reply) => ({ ...reply, working: "Enviando…" }));
  idle(false);
  try {
    if (!session()) setSession(await commands.openSession(root, pendingId ? await pendingId : null));
    pendingId = null;
    await commands.chatSend(root, session(), message, settings);
    loadRail();
  } catch (reason) {
    onReply(replying, (reply) => heard(reply, { kind: "failed", reason: String(reason) }, false));
    replying = null;
    idle(true);
  }
}

export async function halt() {
  const { stopping } = chat.getState();
  if (stopping || !session()) return;
  set({ stopping: true });
  onReply(replying, (reply) => ({ ...reply, working: "Parando…" }));
  try {
    await commands.chatStop(session());
  } catch (reason) {
    warn(String(reason));
    set({ stopping: false });
  }
}

// Claude Code starts before the first message, with the settings chosen, so
// the reply comes sooner.
export async function warm(settings: Settings) {
  const { root } = project.getState();
  if (!root || chat.getState().busy || !settings.provider) return;
  try {
    const id = session() || (await (pendingId ??= commands.newSessionId()));
    const key = JSON.stringify([root, id, settings]);
    if (key === warmed) return;
    warmed = key;
    await commands.chatWarm(root, id, settings);
  } catch {
    warmed = "";
  }
}

// An answer to a question in `reply`: it shows at once, or the question says
// why it could not go.
export async function answer(reply: number, request: string, decision: Decision) {
  await commands.chatAnswer(session(), request, decision);
  onReply(reply, (open) => answered(open, request, decision.allow, decision.answers ?? null));
}

async function afterTurn() {
  idle(true);
  if (project.getState().view === "artifacts") loadShelf();
  await legacy.readRepo();
  if (legacy.panelShows("changes")) await loadChanges();
  await loadFiles();
  await loadRail();
}

function hear(event: ChatEvent) {
  replying ??= open("");
  route(replying, event, true);
  if (!CLOSING.has(event.kind)) return;
  replying = null;
  afterTurn();
}

// Once: what every session says. Another session's end only refreshes the
// rail; its title may come then.
export const hearChat = () =>
  events.chat((from, event) => {
    if (event.kind === "limits") return legacy.noteLimits(event.windows);
    if (CLOSING.has(event.kind)) nameSession(from);
    if (from !== session()) {
      if (CLOSING.has(event.kind)) loadRail();
      return;
    }
    noteTask(event as AgentEvent);
    if (TASK_EVENTS.has(event.kind)) return;
    hear(event);
  });
