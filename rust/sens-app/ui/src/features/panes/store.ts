import { createStore, type StoreApi } from "zustand/vanilla";
import type { ChatEvent, Isolation, Repo, Slash } from "../../ipc/types";
import { store, stored } from "../../shared/storage.js";
import type { Turn } from "../chat/turns";
import type { File, Picture } from "../composer/store";
import { project } from "../project/store";
import { showTasksOf } from "../tasks/store";

export const CHOICE = "sens.choice";
export const ISOLATE = "sens.isolate";
export const isolating = () => stored(ISOLATE, false) === true;
export const EFFORT = "sens.effort";
export const THINKING = "sens.thinking";
const LAYOUT = "sens.panes";

export const LEAST_WIDTH = 340;
export const SHARE_LEAST = 0.25;
export const SHARE_MOST = 0.75;

// The chat of the session on screen: its turns; whether Claude is working
// (`busy`) and being stopped; the hint the empty chat shows; whether a
// session is being drawn back, which skips the entry animations; and how many
// turns ended, for what reads the project again after one.
export interface Chat {
  turns: Turn[];
  busy: boolean;
  stopping: boolean;
  hint: string;
  replaying: boolean;
  ended: number;
  context: { used: number; window: number } | null;
}

// What goes with the next message: effort, thinking and the permission mode
// (kept across launches), the files and pictures attached, and the branch of
// the project, if it is a git repository.
export interface Desk {
  root: string;
  session: string;
  worktree: Isolation | null;
  isolate: boolean;
  text: string;
  attached: File[];
  pasted: Picture[];
  repo: Repo | null;
  trusted: string;
  slashes: Slash[];
  choice: { provider: string; model: string };
  effort: string;
  thinking: boolean;
}

export interface Pane {
  id: string;
  chat: StoreApi<Chat>;
  desk: StoreApi<Desk>;
  // The reply the live events go to, if one is open.
  replying: number | null;
  // The model named last in this chat: a reply names its model only when it changes.
  named: string;
  // A new session's id, asked for before its first message so it can warm up.
  pendingId: Promise<string> | null;
  warmed: string;
  reading: ChatEvent[] | null;
}

export type Side = "left" | "right";

export type Setup = Pick<Desk, "root" | "session" | "choice" | "effort" | "thinking">;

export interface Kept {
  panes: Setup[];
  focus: number;
  share: number;
}

let made = 0;

export function newPane(root = ""): Pane {
  made += 1;
  return {
    id: `pane-${made}`,
    chat: createStore<Chat>(() => ({ turns: [], busy: false, stopping: false, hint: "", replaying: false, ended: 0, context: null })),
    desk: createStore<Desk>(() => ({
      root,
      session: "",
      worktree: null,
      isolate: isolating(),
      text: "",
      attached: [],
      pasted: [],
      repo: null,
      trusted: "",
      slashes: [],
      choice: { provider: "", model: "", ...stored(CHOICE, {}) },
      effort: stored(EFFORT, "") as string,
      thinking: stored(THINKING, true) !== false,
    })),
    replying: null,
    named: "",
    pendingId: null,
    warmed: "",
    reading: null,
  };
}

const first = newPane();

export const panes = createStore(() => ({
  open: [first] as Pane[],
  focus: first.id,
  share: clampShare(Number(stored(LAYOUT, {} as Partial<Kept>).share) || 0.5),
}));

function clampShare(share: number) {
  return Math.min(SHARE_MOST, Math.max(SHARE_LEAST, share));
}

export function focused() {
  const { open, focus } = panes.getState();
  return open.find((pane) => pane.id === focus) ?? open[0];
}

export const split = () => panes.getState().open.length > 1;

export const paneOf = (session: string) => (session ? panes.getState().open.find((pane) => pane.desk.getState().session === session) : undefined);

export const sideOf = (pane: Pane): Side => (panes.getState().open[0] === pane ? "left" : "right");

export const other = (pane: Pane) => panes.getState().open.find((one) => one !== pane);

export const workOf = (pane: Pane) => pane.desk.getState().worktree?.path || pane.desk.getState().root;

export function worktreePending(pane: Pane) {
  const { isolate, worktree, repo } = pane.desk.getState();
  return isolate && !worktree && Boolean(repo);
}

let workMoved = () => {};
export const whenWorkMoves = (then: () => unknown) => void (workMoved = () => void then());

function mirror() {
  const pane = focused();
  const { root, session } = pane.desk.getState();
  const work = workOf(pane);
  const shown = project.getState();
  if (shown.root !== root || shown.session !== session || shown.work !== work) project.setState({ root, session, work });
  if (shown.root === root && shown.work !== work) workMoved();
  showTasksOf(session);
}

const watched = new Map<Pane, () => void>();

function watch(pane: Pane) {
  if (watched.has(pane)) return;
  const off = pane.desk.subscribe((now, before) => {
    if (now.root !== before.root || now.session !== before.session || now.worktree !== before.worktree) {
      if (pane === focused()) mirror();
      return keep();
    }
    if (split() && (now.choice !== before.choice || now.effort !== before.effort || now.thinking !== before.thinking)) keep();
  });
  watched.set(pane, off);
}

function forget(gone: Pane[]) {
  for (const pane of gone) {
    watched.get(pane)?.();
    watched.delete(pane);
  }
}

watch(first);
panes.subscribe(mirror);

export function setFocus(id: string) {
  if (panes.getState().focus !== id) panes.setState({ focus: id });
}

export function place(pane: Pane, side: Side) {
  watch(pane);
  const { open } = panes.getState();
  const stays = [open.length > 1 ? open[side === "left" ? 1 : 0] : open[0]].filter((one) => one && one !== pane);
  const next = side === "left" ? [pane, ...stays] : [...stays, pane];
  panes.setState({ open: next, focus: pane.id });
  forget(open.filter((one) => !next.includes(one)));
  keep();
}

export function close(pane: Pane) {
  const { open, focus } = panes.getState();
  if (open.length < 2) return;
  const left = open.filter((one) => one !== pane);
  panes.setState({ open: left, focus: focus === pane.id ? left[0].id : focus });
  forget([pane]);
  keep();
}

export function share(to: number) {
  panes.setState({ share: clampShare(to) });
  keep();
}

function keep() {
  const { open, focus, share } = panes.getState();
  const kept: Kept = {
    panes: open.map((pane) => {
      const { root, session, choice, effort, thinking } = pane.desk.getState();
      return { root, session, choice, effort, thinking };
    }),
    focus: Math.max(0, open.findIndex((pane) => pane.id === focus)),
    share,
  };
  store(LAYOUT, kept);
}

export const keptLayout = () => stored(LAYOUT, null) as Kept | null;
