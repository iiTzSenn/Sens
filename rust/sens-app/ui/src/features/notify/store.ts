import { getCurrentWindow } from "@tauri-apps/api/window";
import { commands } from "../../ipc/commands";
import type { ChatEvent } from "../../ipc/types";
import { shared } from "../../shared/copy";
import { describe } from "../chat/looks";
import { profile } from "../profile/store";
import { rail } from "../rail/store";
import { t } from "./copy";

const QUIET = 4000;
const BODY_CAP = 120;

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
      if (event.tool === "AskUserQuestion") return t.question;
      if (event.tool === "ExitPlanMode") return t.plan;
      const { verb, target } = describe(event.tool, event.input || {});
      const said = t.permission([verb, target].filter(Boolean).join(" "));
      return said.length > BODY_CAP ? `${said.slice(0, BODY_CAP - 1)}…` : said;
    }
    case "finished":
      return event.stopped ? "" : event.ok ? t.finished : t.finishedBadly;
    case "failed":
      return t.failed;
    default:
      return "";
  }
}

const titleOf = (session: string) =>
  rail
    .getState()
    .spaces?.flatMap((space) => space.sessions)
    .find((one) => one.id === session)?.title || shared.newSession;

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
