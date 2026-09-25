import { useEffect, useState } from "react";
import { paint, paintedNow, type Look, type Painted } from "./paint";
import { nestsOf, type Nest } from "./shells";

const KEPT = 400;
const kept = new Map<string, Painted>();

const keyOf = (text: string, language: string) => `${language}\n${text}`;

function keep(key: string, painted: Painted) {
  kept.delete(key);
  kept.set(key, painted);
  if (kept.size > KEPT) kept.delete(kept.keys().next().value!);
}

function masked(text: string, nests: Nest[]) {
  let out = "";
  let at = 0;
  for (const nest of nests) {
    out += text.slice(at, nest.from) + text.slice(nest.from, nest.to).replace(/\S/g, "x");
    at = nest.to;
  }
  return out + text.slice(at);
}

function flat(painted: Painted | null, text: string): [string, Look | undefined][] {
  if (!painted) return [[text, undefined]];
  const pieces = painted.lines.flatMap((runs, at) => [
    ...(at ? [["\n", undefined] as [string, undefined]] : []),
    ...runs.map(([piece, look]) => [piece, look < 0 ? undefined : painted.looks[look]] as [string, Look | undefined]),
  ]);
  return pieces.reduce((length, [piece]) => length + piece.length, 0) === text.length ? pieces : [[text, undefined]];
}

export function overlay(text: string, outer: Painted | null, nests: Nest[], inner: (Painted | null)[]): Painted {
  const looks: Look[] = [];
  const known = new Map<string, number>();
  const lines: [string, number][][] = [[]];
  const indexOf = (look?: Look) => {
    if (!look) return -1;
    const key = JSON.stringify(look);
    if (!known.has(key)) {
      known.set(key, looks.length);
      looks.push(look);
    }
    return known.get(key)!;
  };
  const put = (piece: string, look?: Look) =>
    piece.split("\n").forEach((part, at) => {
      if (at) lines.push([]);
      if (!part) return;
      const line = lines[lines.length - 1];
      const index = indexOf(look);
      const last = line[line.length - 1];
      if (last && last[1] === index) last[0] += part;
      else line.push([part, index]);
    });

  let offset = 0;
  let next = 0;
  for (const [piece, look] of flat(outer, text)) {
    let start = offset;
    const end = offset + piece.length;
    while (start < end) {
      const nest = nests[next];
      if (nest && start >= nest.from) {
        if (start === nest.from) for (const [part, own] of flat(inner[next], text.slice(nest.from, nest.to))) put(part, own);
        start = Math.min(end, nest.to);
        if (start >= nest.to) next++;
        continue;
      }
      const stop = nest ? Math.min(end, nest.from) : end;
      put(text.slice(start, stop), look);
      start = stop;
    }
    offset = end;
  }
  return { looks, lines };
}

export async function paintCode(text: string, language: string | null, wanted = () => true): Promise<Painted | null> {
  if (!language || !text) return null;
  const key = keyOf(text, language);
  if (kept.has(key)) return kept.get(key)!;
  const nests = nestsOf(text, language);
  if (!nests.length) return paint(text, language, wanted);
  const [outer, ...inner] = await Promise.all([paint(masked(text, nests), language, wanted), ...nests.map((nest) => paint(text.slice(nest.from, nest.to), nest.language, wanted))]);
  if (!wanted()) return null;
  const painted = overlay(text, outer, nests, inner);
  keep(key, painted);
  return painted;
}

export function codeNow(text: string, language: string | null): Painted | null {
  if (!language || !text) return null;
  return kept.get(keyOf(text, language)) ?? (nestsOf(text, language).length ? null : paintedNow(text, language));
}

export function useCode(text: string, language: string | null) {
  const now = codeNow(text, language);
  const [done, setDone] = useState<{ text: string; language: string | null; painted: Painted | null }>();
  useEffect(() => {
    if (!language || !text || codeNow(text, language)) return;
    let live = true;
    paintCode(text, language, () => live).then((painted) => live && setDone({ text, language, painted }));
    return () => {
      live = false;
    };
  }, [text, language]);
  return now ?? (done?.text === text && done.language === language ? done.painted : null);
}
