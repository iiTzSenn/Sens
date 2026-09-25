import type { Run } from "./ansi";

export type Shape = "json" | "diff" | "text";
export type Cue = "error" | "warning" | "";
export type Hunk = "add" | "del" | "hunk" | "head" | "";

export interface Mark {
  from: number;
  to: number;
  url?: string;
  path?: string;
}

const JSON_LONGEST = 200_000;
const HUNK = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m;
const FILES = /^(?:---|\+\+\+) \S/m;
const HEAD = /^(?:diff --git |index [0-9a-f]+\.\.|--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (?:from|to) |old mode|new mode)/;
const ERROR = /^\s*(?:(?:error|fatal)(?:\[[\w-]+\])?:|Error:|ERROR\b|FAIL(?:ED)?\b|npm ERR!|[A-Z]\w*(?:Error|Exception):|Traceback \(most recent call last\):)/;
const WARNING = /^\s*(?:warning(?:\[[\w-]+\])?:|Warning:|WARN(?:ING)?\b|npm WARN\b)/;
const WEB = /\bhttps?:\/\/[^\s<>"'`]+/g;
const PLACE = /(?<![\w/\\.:@-])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w@.+-]+[\\/])*[\w@+-][\w@.+-]*\.[A-Za-z]\w{0,7}):(\d+)(?::\d+)?(?![\w.])/g;
const TRAILING = /[.,;:!?'"]+$/;

function parses(text: string) {
  if (text.length > JSON_LONGEST || !/^[[{]/.test(text) || !/[\]}]$/.test(text)) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export const shapeOf = (text: string): Shape => (parses(text.trim()) ? "json" : HUNK.test(text) && FILES.test(text) ? "diff" : "text");

export function hunkOf(line: string): Hunk {
  if (HEAD.test(line)) return "head";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "";
}

export const cueOf = (line: string): Cue => (ERROR.test(line) ? "error" : WARNING.test(line) ? "warning" : "");

function webEnd(url: string) {
  let end = url.replace(TRAILING, "");
  while (end.endsWith(")") && (end.match(/\(/g) || []).length < (end.match(/\)/g) || []).length) end = end.slice(0, -1).replace(TRAILING, "");
  return end;
}

export function marksOf(line: string, places = true): Mark[] {
  const marks: Mark[] = [];
  for (const found of line.matchAll(WEB)) {
    const url = webEnd(found[0]);
    marks.push({ from: found.index, to: found.index + url.length, url });
  }
  if (places) {
    for (const found of line.matchAll(PLACE)) {
      const from = found.index;
      const to = from + found[0].length;
      if (!marks.some((mark) => from < mark.to && to > mark.from)) marks.push({ from, to, path: found[1] });
    }
  }
  return marks.sort((one, two) => one.from - two.from);
}

export function within(runs: Run[], from: number, to: number): Run[] {
  const out: Run[] = [];
  let at = 0;
  for (const [piece, style] of runs) {
    const end = at + piece.length;
    if (end > from && at < to) out.push([piece.slice(Math.max(0, from - at), Math.min(piece.length, to - at)), style]);
    at = end;
  }
  return out;
}
