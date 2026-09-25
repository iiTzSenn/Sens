import type { Entry, Slash } from "../../ipc/types";

export const SUGGEST_CAP = 8;

export interface Trigger {
  kind: "file" | "command";
  start: number;
  end: number;
  query: string;
}

const COMMAND = /^\/(\S*)$/;
const MENTION = /(^|\s)@("[^"]*|[^\s"]*)$/;
const WORD_ON = /^\S*/;
const SPACED = /\s/;

export function triggerAt(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  const end = caret + (WORD_ON.exec(text.slice(caret))?.[0].length ?? 0);
  const command = COMMAND.exec(before);
  if (command) return { kind: "command", start: 0, end, query: command[1] };
  const mention = MENTION.exec(before);
  if (!mention) return null;
  const typed = mention[2];
  return { kind: "file", start: caret - typed.length - 1, end, query: typed.replace(/^"/, "") };
}

function score(query: string, short: string, full: string) {
  const want = query.toLowerCase();
  const name = short.toLowerCase();
  const whole = full.toLowerCase();
  if (name.startsWith(want) || whole.startsWith(want)) return 0;
  if (name.includes(want)) return 1;
  return whole.includes(want) ? 2 : -1;
}

function ranked<T>(items: T[], query: string, short: (item: T) => string, full: (item: T) => string) {
  return items
    .map((item) => ({ item, rank: score(query, short(item), full(item)) }))
    .filter((one) => one.rank >= 0)
    .sort((one, other) => one.rank - other.rank || full(one.item).length - full(other.item).length || full(one.item).localeCompare(full(other.item)))
    .slice(0, SUGGEST_CAP)
    .map((one) => one.item);
}

export const rankSlashes = (slashes: Slash[], query: string) =>
  ranked(slashes, query, (slash) => slash.name.slice(slash.name.lastIndexOf(":") + 1), (slash) => slash.name);

export const rankFiles = (files: Entry[], query: string) =>
  ranked(
    files.filter((file) => !file.dir),
    query,
    (file) => file.name,
    (file) => file.path,
  );

export const inFolder = (folder: string, path: string) => `${folder.replace(/[\\/]+$/, "")}/${path}`;

export const mentionOf = (path: string) => `@${SPACED.test(path) ? `"${path}"` : path} `;

export const commandOf = (name: string) => `/${name} `;

export function applied(text: string, trigger: Trigger, insert: string) {
  const rest = text.slice(trigger.end);
  return {
    text: text.slice(0, trigger.start) + insert + (rest.startsWith(" ") ? rest.slice(1) : rest),
    caret: trigger.start + insert.length,
  };
}
