import { FENCE, inline, mended, splitBlocks, type Inline } from "../../shared/markdown/parse";
import { EDITS, SHELLS } from "./looks";
import type { Part, Step, Thought } from "./turns";

export const FOLD_AT = 5;
const TITLE_MOST = 160;
const LOOK_BACK = 3;

export type Work = Step | Thought;

export interface Stretch {
  kind: "run";
  key: number;
  parts: Work[];
}

export type Piece = Exclude<Part, Work> | Stretch;

export function grouped(parts: Part[]): Piece[] {
  const pieces: Piece[] = [];
  let run: Stretch | null = null;
  for (const part of parts) {
    if (part.kind !== "step" && part.kind !== "thought") {
      run = null;
      pieces.push(part);
      continue;
    }
    if (!run) pieces.push((run = { kind: "run", key: part.key, parts: [] }));
    run.parts.push(part);
  }
  return pieces;
}

export const sameWork = (was: Work[], now: Work[]) => was.length === now.length && was.every((part, at) => part === now[at]);

const HEADING = /^[ \t]*(?:#{1,6}[ \t]+(.+?)[ \t#]*|\*\*([^*\n]+)\*\*[ \t]*:?|__([^_\n]+)__[ \t]*:?)[ \t]*$/gm;
const LEAD = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm;
const ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;
const FIRST = /^.*?(?:[.!?](?=\s|$)|[。！？])/;
const WHOLE = /[^.!?。！？]+(?:[.!?]+(?=\s|$)|[。！？]+)/g;

const flat = (nodes: Inline[]): string => nodes.map((node) => (node.kind === "text" || node.kind === "code" ? node.text : flat(node.children))).join("");
const plain = (text: string) => flat(inline(mended(text.replace(LEAD, "")))).replace(/\s+/g, " ").trim();
const prose = (text: string) => splitBlocks(text).filter((block) => !FENCE.test(block));

function headings(text: string) {
  return [...text.matchAll(HEADING)].map((match) => plain(match[1] ?? match[2] ?? match[3])).filter(Boolean);
}

function firstSentence(text: string) {
  const block = prose(text)[0] ?? "";
  const line = plain(ITEM.test(block) ? block.split("\n")[0] : block);
  return line.match(FIRST)?.[0] ?? line;
}

function lastSentence(text: string) {
  const blocks = prose(text).slice(-LOOK_BACK);
  for (let at = blocks.length - 1; at >= 0; at--) {
    const whole = plain(blocks[at]).match(WHOLE);
    if (whole) return whole[whole.length - 1];
  }
  return "";
}

function trimmed(title: string) {
  const bare = title.replace(/[\s.:。：]+$/u, "").trim();
  return bare.length > TITLE_MOST ? `${bare.slice(0, TITLE_MOST - 1).trimEnd()}…` : bare;
}

export function titleOf(text: string, live: boolean) {
  if (!live) return trimmed(headings(text)[0] ?? firstSentence(text));
  const heads = headings(text.slice(0, text.lastIndexOf("\n") + 1));
  return trimmed(heads[heads.length - 1] ?? lastSentence(text));
}

export const tookOf = (part: Work) => (part.began !== null && part.ended !== null ? part.ended - part.began : null);

export interface Tally {
  commands: number;
  reads: number;
  edits: number;
  searches: number;
  others: number;
  failed: number;
  took: number | null;
}

const SEARCHES = new Set(["Grep", "Glob", "WebSearch"]);
const UNCOUNTED = new Set(["TodoWrite"]);

export function tally(parts: Work[]): Tally {
  const told: Tally = { commands: 0, reads: 0, edits: 0, searches: 0, others: 0, failed: 0, took: spanOf(parts) };
  for (const part of parts) {
    if (part.kind !== "step") continue;
    if (part.state === "failed") told.failed += 1;
    if (SHELLS.has(part.name)) told.commands += 1;
    else if (part.name === "Read") told.reads += 1;
    else if (EDITS.has(part.name)) told.edits += 1;
    else if (SEARCHES.has(part.name)) told.searches += 1;
    else if (!UNCOUNTED.has(part.name)) told.others += 1;
  }
  return told;
}

function spanOf(parts: Work[]) {
  const began = parts[0]?.began ?? null;
  const ends = parts.flatMap((part) => (part.ended === null ? [] : [part.ended]));
  return began === null || !ends.length ? null : Math.max(...ends) - began;
}
