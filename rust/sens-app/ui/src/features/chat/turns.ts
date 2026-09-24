import type { Answers, Asking, ChatEvent, Finished, Link, ToolDetail, ToolInput } from "../../ipc/types";
import { SILENT, footOf } from "./looks";

// The chat as data: what you asked, what Claude replied, and notices the app
// adds (a branch switched, something refused). Each piece has a key that stays
// while it lives on screen.

// Text the model wrote. `streamed` when it arrived piece by piece (it is
// revealed as it comes); `settled` once the full text came; `done` once
// the turn ended and it shows whole at once.
export interface Said {
  kind: "said";
  key: number;
  text: string;
  streamed: boolean;
  settled: boolean;
  done: boolean;
}

export interface Thought {
  kind: "thought";
  key: number;
  text: string;
  settled: boolean;
  done: boolean;
}

export interface Step {
  kind: "step";
  key: number;
  id: string;
  name: string;
  input: ToolInput;
  state: "running" | "done" | "failed" | "stopped";
  output: string;
  detail: ToolDetail | null;
  links: Link[];
}

// A question for you: permission for a tool, a plan to approve, a form. It
// waits for an answer only while `active`.
export interface Ask {
  kind: "ask";
  key: number;
  event: Asking;
  active: boolean;
  state: "" | "waiting" | "allowed" | "refused" | "expired";
  answers: Answers | null;
}

export interface Line {
  kind: "fault" | "foot";
  key: number;
  text: string;
}

export type Part = Said | Thought | Step | Ask | Line;

// `open` is the part taking the deltas that arrive; `working`, what the live
// line says while Claude works (empty when it does not show).
export interface Reply {
  kind: "reply";
  key: number;
  who: string;
  parts: Part[];
  open: number | null;
  working: string;
  began: number;
  closed: boolean;
}

// Pictures come as data URLs, or read later when a session is replayed.
export type Picture = string | Promise<string>;

export interface You {
  kind: "you";
  key: number;
  text: string;
  files: string[];
  pictures: Picture[];
}

export type Piece = string | { bold: string };

export interface Notice {
  kind: "notice";
  key: number;
  parts: Piece[];
  tone: "" | "warn";
}

export type Turn = You | Reply | Notice;

let keys = 0;
export const nextKey = () => ++keys;

export const CLOSING = new Set(["finished", "failed"]);

export const opening = (who = ""): Reply => ({
  kind: "reply",
  key: nextKey(),
  who,
  parts: [],
  open: null,
  working: "",
  began: performance.now(),
  closed: false,
});

const said = (text: string, streamed: boolean): Said => ({ kind: "said", key: nextKey(), text, streamed, settled: !streamed, done: !streamed });
const thought = (text: string, settled: boolean): Thought => ({ kind: "thought", key: nextKey(), text, settled, done: settled });

const swap = <Kind extends Part>(reply: Reply, key: number, change: (part: Kind) => Kind): Reply => ({
  ...reply,
  parts: reply.parts.map((part) => (part.key === key ? change(part as Kind) : part)),
});

// A delta goes on the part it belongs to; a switch between thinking and
// writing opens a new one.
function delta(reply: Reply, thinking: boolean, text: string): Reply {
  const kind = thinking ? "thought" : "said";
  const open = reply.parts.find((part) => part.key === reply.open);
  if (open?.kind === kind) return swap<Said | Thought>(reply, open.key, (part) => ({ ...part, text: part.text + text }));
  const fresh = thinking ? thought(text, false) : said(text, true);
  return { ...reply, parts: [...reply.parts, fresh], open: fresh.key };
}

// The full text replaces what the deltas built, on the first part of its kind
// still waiting for it; without one, it is a part of its own.
function settle(reply: Reply, thinking: boolean, text: string): Reply {
  const kind = thinking ? "thought" : "said";
  const waiting = reply.parts.find((part): part is Said | Thought => part.kind === kind && !part.settled);
  if (!waiting) return { ...reply, parts: [...reply.parts, thinking ? thought(text, true) : said(text, false)] };
  const settled = swap<Said | Thought>(reply, waiting.key, (part) => ({ ...part, text, settled: true, done: part.kind === "thought" || part.done }));
  return reply.open === waiting.key ? { ...settled, open: null } : settled;
}

// The turn ended: text shows whole, thoughts end, questions left unanswered
// expire and tools still running stop.
function close(reply: Reply): Reply {
  return {
    ...reply,
    open: null,
    working: "",
    closed: true,
    parts: reply.parts.map((part): Part => {
      if (part.kind === "said" || part.kind === "thought") return part.done ? part : { ...part, done: true };
      if (part.kind === "ask" && part.state !== "allowed" && part.state !== "refused") return { ...part, active: false, state: "expired" };
      if (part.kind === "step" && part.state === "running") return { ...part, state: "stopped" };
      return part;
    }),
  };
}

const line = (kind: Line["kind"], text: string): Line => ({ kind, key: nextKey(), text });

// One event on the reply it belongs to. `live`: whether an ask may still be
// answered (a replayed one only while its turn is still running).
export function heard(reply: Reply, event: ChatEvent, live: boolean): Reply {
  switch (event.kind) {
    case "delta":
      return delta(reply, event.thinking, event.text);
    case "said":
      return settle(reply, false, event.text);
    case "thought":
      return settle(reply, true, event.text);
    case "tool":
      if (SILENT.has(event.name)) return { ...reply, open: null };
      return {
        ...reply,
        open: null,
        parts: [
          ...reply.parts,
          { kind: "step", key: nextKey(), id: event.id, name: event.name, input: event.input || {}, state: "running", output: "", detail: null, links: [] },
        ],
      };
    case "toolDone": {
      const step = reply.parts.find((part): part is Step => part.kind === "step" && part.id === event.id);
      if (!step) return reply;
      return swap<Step>(reply, step.key, (part) => ({ ...part, state: event.error ? "failed" : "done", output: event.output, detail: event.detail }));
    }
    case "consulted": {
      const step = reply.parts.find((part): part is Step => part.kind === "step" && part.id === event.tool);
      if (!step) return reply;
      return swap<Step>(reply, step.key, (part) => {
        const known = new Map(part.links.map((link) => [link.url, link]));
        for (const link of event.links) known.set(link.url, link);
        return { ...part, links: [...known.values()] };
      });
    }
    case "asking":
      return {
        ...reply,
        open: null,
        parts: [...reply.parts, { kind: "ask", key: nextKey(), event, active: live, state: live ? "waiting" : "", answers: null }],
      };
    case "answered": {
      const ask = reply.parts.find((part): part is Ask => part.kind === "ask" && part.event.request === event.request);
      if (!ask) return reply;
      return swap<Ask>(reply, ask.key, (part) => ({ ...part, active: false, state: event.allowed ? "allowed" : "refused", answers: event.answers }));
    }
    case "finished": {
      const ended = close(reply);
      const foot = footOf(event as Finished);
      return {
        ...ended,
        parts: [...ended.parts, ...(event.error ? [line("fault", event.error)] : []), ...(foot ? [line("foot", foot)] : [])],
      };
    }
    case "failed": {
      const ended = close(reply);
      return { ...ended, parts: [...ended.parts, line("fault", event.reason)] };
    }
    default:
      return reply;
  }
}

// An answer given here, before the event that confirms it comes back.
export const answered = (reply: Reply, request: string, allowed: boolean, answers: Answers | null): Reply =>
  heard(reply, { kind: "answered", request, allowed, answers }, false);
