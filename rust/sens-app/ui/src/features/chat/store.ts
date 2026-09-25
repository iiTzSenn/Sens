import { commands, events } from "../../ipc/commands";
import type { AgentEvent, ChatEvent, Decision, Message, SessionEntry, Settings } from "../../ipc/types";
import { panelShows } from "../../app/shell";
import { loadShelf } from "../artifacts/store";
import { loadChanges, soonChanges } from "../changes/store";
import { loadFiles } from "../files/store";
import { openFile, viewer } from "../files/view";
import { modelName, noteLimits } from "../models/store";
import { focused, paneOf, type Pane } from "../panes/store";
import { noteEdit, project } from "../project/store";
import { loadRail, nameSession, noteActivity, type Activity } from "../rail/store";
import { forgetTasks, noteTask, settleTasks } from "../tasks/store";
import { TASK_EVENTS } from "../tasks/tasks";
import { onProject, reloadSite } from "../web/store";
import { SILENT, consulting, editOf, statusOf } from "./looks";
import { notice, warn } from "./state";
import { CLOSING, answered, heard, nextKey, opening, type Picture, type Reply } from "./turns";

export { notice, warn };

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

const session = (pane: Pane) => pane.desk.getState().session;
const setSession = (pane: Pane, id: string) => pane.desk.setState({ session: id });
const rootOf = (pane: Pane) => pane.desk.getState().root;
const onScreen = (pane: Pane) => rootOf(pane) === project.getState().root;

// The empty chat invites to start, or to pick a folder first.
export const hello = (pane: Pane = focused()) => pane.chat.setState({ hint: rootOf(pane) ? nextHint() : NO_ROOT });

function onReply(pane: Pane, key: number | null, change: (reply: Reply) => Reply) {
  if (key === null) return;
  pane.chat.setState(({ turns }) => ({ turns: turns.map((turn) => (turn.kind === "reply" && turn.key === key ? change(turn) : turn)) }));
}

// A new reply, named after its model when the model changed since the last.
function open(pane: Pane, model: string) {
  const reply = opening(nameOf(pane, model));
  pane.chat.setState(({ turns }) => ({ turns: [...turns, reply] }));
  return reply.key;
}

function nameOf(pane: Pane, model: string) {
  if (!model) return "";
  const said = modelName(model);
  if (said === pane.named) return "";
  const first = !pane.named;
  pane.named = said;
  return first ? "" : said;
}

export function idle(on: boolean, pane: Pane = focused()) {
  pane.chat.setState({ busy: !on, stopping: false });
}

// A new session, empty: it gets its id once the first message goes.
export function blank(id: string, pane: Pane = focused()) {
  setSession(pane, id);
  pane.named = "";
  pane.replying = null;
  pane.pendingId = null;
  pane.warmed = "";
  pane.reading = null;
  pane.chat.setState({ turns: [] });
  forgetTasks(id);
}

// The agent changed a file: the tree and the viewer mark it, and what shows it
// (the file, the page, the changes) reads it again.
function touched(edit: { path: string; lines: number[]; plus: number; minus: number }) {
  noteEdit(edit);
  if (viewer.getState().opened === edit.path) openFile(edit.path);
  if (onProject() && panelShows("web")) reloadSite();
  if (panelShows("changes")) soonChanges();
}

// One event on the reply it goes to, and what the live line says of it.
function route(pane: Pane, key: number, event: ChatEvent, live: boolean) {
  onReply(pane, key, (reply) => heard(reply, event, live));
  if (event.kind === "started") {
    const who = nameOf(pane, event.model);
    if (who) onReply(pane, key, (reply) => ({ ...reply, who }));
  }
  if (event.kind === "toolDone") {
    const step = pane.chat
      .getState()
      .turns.flatMap((turn) => (turn.kind === "reply" ? turn.parts : []))
      .find((part) => part.kind === "step" && part.id === event.id);
    const edit = step?.kind === "step" ? editOf(step.name, step.input, event.detail) : null;
    if (edit?.path && !event.error && onScreen(pane)) touched({ path: edit.path, lines: edit.added, plus: edit.plus, minus: edit.minus });
  }
  if (!live) return;
  const said = working(event);
  if (said) onReply(pane, key, (reply) => (reply.closed ? reply : { ...reply, working: said }));
}

function working(event: ChatEvent) {
  switch (event.kind) {
    case "started":
      return "Trabajando…";
    case "delta":
      return event.thinking ? "Trabajando…" : "Escribiendo…";
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

const inRoot = (pane: Pane, path: string) => `${rootOf(pane).replace(/[\\/]+$/, "")}/${path}`;

// A saved session drawn back as it went. A question still waiting when the
// session is still running can be answered.
export async function load(id: string, pane: Pane = focused()) {
  blank(id, pane);
  const meanwhile: ChatEvent[] = [];
  pane.reading = meanwhile;
  const root = rootOf(pane);
  const [entries, running, alive] = await Promise.all([commands.replay(root, id), commands.chatBusy(id), commands.chatTasks(id)]);
  if (pane.reading !== meanwhile) return;
  const answeredOnes = new Set(entries.flatMap((entry) => (entry.kind === "agent" && entry.event.kind === "answered" ? [entry.event.request] : [])));

  pane.chat.setState({ replaying: true });
  requestAnimationFrame(() => requestAnimationFrame(() => pane.chat.setState({ replaying: false })));

  let reply: number | null = null;
  let midTurn = false;
  let asking = false;
  for (const entry of entries as SessionEntry[]) {
    if (entry.kind === "task") {
      asked(
        pane,
        entry.text,
        entry.files,
        (entry.images || []).map((path) => commands.artifactData(inRoot(pane, path))),
      );
      reply = null;
      midTurn = true;
      continue;
    }
    if (entry.kind !== "agent") continue;
    const event = entry.event;
    noteTask(event as AgentEvent, entry.at, id);
    if (TASK_EVENTS.has(event.kind)) continue;
    reply ??= open(pane, event.kind === "started" ? event.model : "");
    const waiting = running && event.kind === "asking" && !answeredOnes.has(event.request);
    asking ||= waiting;
    route(pane, reply, event, waiting);
    midTurn = !CLOSING.has(event.kind);
    if (!midTurn) reply = null;
  }

  const busy = running && midTurn;
  pane.replying = reply ?? (busy ? open(pane, "") : null);
  if (busy) onReply(pane, pane.replying, (open) => ({ ...open, working: "Trabajando…" }));
  settleTasks(alive, id);
  noteActivity(id, busy ? (asking ? "waiting" : "working") : null);
  idle(!busy, pane);
  pane.reading = null;
  for (const event of unlogged(entries, meanwhile)) hear(pane, event);
  if (!pane.chat.getState().turns.length) hello(pane);
  await loadRail();
}

function unlogged(entries: SessionEntry[], caught: ChatEvent[]) {
  const logged = entries.flatMap((entry) => (entry.kind === "agent" && !TASK_EVENTS.has(entry.event.kind) ? [JSON.stringify(entry.event)] : []));
  const lasting = caught.flatMap((event, at) => (event.kind === "delta" ? [] : [at]));
  for (let known = Math.min(lasting.length, logged.length); known > 0; known--) {
    const tail = logged.slice(-known);
    if (lasting.slice(0, known).every((at, nth) => JSON.stringify(caught[at]) === tail[nth])) return caught.slice(lasting[known - 1] + 1);
  }
  return caught;
}

function asked(pane: Pane, text: string, files: string[], pictures: Picture[]) {
  pane.chat.setState(({ turns }) => ({ turns: [...turns, { kind: "you", key: nextKey(), text, files, pictures }] }));
}

// A message as the composer hands it: what to send, and how it shows.
export interface Outgoing {
  message: Message;
  shownFiles: string[];
  pictures: string[];
}

export async function send({ message, shownFiles, pictures }: Outgoing, settings: Settings, pane: Pane = focused()) {
  const root = rootOf(pane);
  asked(pane, message.text, shownFiles, pictures);
  pane.replying = open(pane, settings.model);
  onReply(pane, pane.replying, (reply) => ({ ...reply, working: "Enviando…" }));
  idle(false, pane);
  try {
    if (!session(pane)) setSession(pane, await commands.openSession(root, pane.pendingId ? await pane.pendingId : null));
    pane.pendingId = null;
    await commands.chatSend(root, session(pane), message, settings);
    loadRail();
  } catch (reason) {
    onReply(pane, pane.replying, (reply) => heard(reply, { kind: "failed", reason: String(reason) }, false));
    pane.replying = null;
    idle(true, pane);
  }
}

export async function halt(pane: Pane = focused()) {
  const { stopping } = pane.chat.getState();
  if (stopping || !session(pane)) return;
  pane.chat.setState({ stopping: true });
  onReply(pane, pane.replying, (reply) => ({ ...reply, working: "Parando…" }));
  try {
    await commands.chatStop(session(pane));
  } catch (reason) {
    warn(String(reason), pane);
    pane.chat.setState({ stopping: false });
  }
}

// Claude Code starts before the first message, with the settings chosen, so
// the reply comes sooner.
export async function warm(settings: Settings, pane: Pane = focused()) {
  const root = rootOf(pane);
  if (!root || pane.chat.getState().busy || !settings.provider) return;
  try {
    const id = session(pane) || (await (pane.pendingId ??= commands.newSessionId()));
    const key = JSON.stringify([root, id, settings]);
    if (key === pane.warmed) return;
    pane.warmed = key;
    await commands.chatWarm(root, id, settings);
  } catch {
    pane.warmed = "";
  }
}

// An answer to a question in `reply`: it shows at once, or the question says
// why it could not go.
export async function answer(reply: number, request: string, decision: Decision, pane: Pane = focused()) {
  await commands.chatAnswer(session(pane), request, decision);
  onReply(pane, reply, (open) => answered(open, request, decision.allow, decision.answers ?? null));
}

const turnEnded: ((pane: Pane) => unknown)[] = [];
export const whenTurnEnds = (then: (pane: Pane) => unknown) => void turnEnded.push(then);

async function afterTurn(pane: Pane) {
  idle(true, pane);
  pane.chat.setState(({ ended }) => ({ ended: ended + 1 }));
  for (const then of turnEnded) then(pane);
  if (project.getState().view === "artifacts") loadShelf();
  if (onScreen(pane)) {
    if (panelShows("changes")) await loadChanges();
    await loadFiles();
  }
  await loadRail();
}

function hear(pane: Pane, event: ChatEvent) {
  pane.replying ??= open(pane, "");
  route(pane, pane.replying, event, true);
  if (!CLOSING.has(event.kind)) return;
  pane.replying = null;
  afterTurn(pane);
}

// Once: what every session says. Another session's end only refreshes the
// rail; its title may come then.
const activityAfter = (kind: string, seen: boolean): Activity | null =>
  CLOSING.has(kind) ? (seen ? null : "done") : kind === "asking" ? "waiting" : "working";

export const hearChat = () =>
  events.chat((from, event) => {
    if (event.kind === "limits") return noteLimits(event.windows);
    const pane = paneOf(from);
    if (!TASK_EVENTS.has(event.kind)) noteActivity(from, activityAfter(event.kind, Boolean(pane)));
    if (CLOSING.has(event.kind)) nameSession(from);
    if (!pane) {
      if (CLOSING.has(event.kind)) loadRail();
      return;
    }
    noteTask(event as AgentEvent, Date.now(), from);
    if (TASK_EVENTS.has(event.kind)) return;
    if (pane.reading) pane.reading.push(event);
    else hear(pane, event);
  });
