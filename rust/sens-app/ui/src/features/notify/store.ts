import { getCurrentWindow } from "@tauri-apps/api/window";
import { commands } from "../../ipc/commands";
import type { ChatEvent } from "../../ipc/types";
import { describe } from "../chat/looks";
import { profile } from "../profile/store";
import { rail } from "../rail/store";

const QUIET = 4000;
const BODY_CAP = 120;
const UNTITLED = "Sesión nueva";

const told = new Map<string, number>();
let present = true;

export const notePresence = (on: boolean) => void (present = on);

export function watchPresence() {
  const frame = getCurrentWindow();
  frame.isFocused().then((on) => notePresence(on !== false), () => {});
  return frame.onFocusChanged(({ payload }) => notePresence(payload));
}

export function noticeOf(event: ChatEvent) {
  switch (event.kind) {
    case "asking": {
      if (event.tool === "AskUserQuestion") return "Tiene una pregunta para ti.";
      if (event.tool === "ExitPlanMode") return "Tiene un plan para que lo revises.";
      const { verb, target } = describe(event.tool, event.input || {});
      const said = `Necesita tu permiso: ${[verb, target].filter(Boolean).join(" ")}`;
      return said.length > BODY_CAP ? `${said.slice(0, BODY_CAP - 1)}…` : said;
    }
    case "finished":
      return event.stopped ? "" : event.ok ? "Ha terminado." : "Terminó con un error.";
    case "failed":
      return "Se paró por un error.";
    default:
      return "";
  }
}

const titleOf = (session: string) =>
  rail
    .getState()
    .spaces?.flatMap((space) => space.sessions)
    .find((one) => one.id === session)?.title || UNTITLED;

export function tellAway(session: string, event: ChatEvent, now = Date.now()) {
  if (!profile.getState().person.notify || present) return;
  const body = noticeOf(event);
  if (!body) return;
  const asking = event.kind === "asking";
  if (asking && now - (told.get(session) ?? -Infinity) < QUIET) return;
  told.set(session, now);
  commands.notify(titleOf(session), body).catch(() => {});
}

export async function setNotices(on: boolean) {
  await commands.setNotify(on);
  profile.setState(({ person }) => ({ person: { ...person, notify: on } }));
}
