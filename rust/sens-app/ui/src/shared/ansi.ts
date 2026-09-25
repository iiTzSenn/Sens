export type Color = number | readonly [number, number, number];

export interface Style {
  fg?: Color;
  bg?: Color;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strike?: boolean;
  hidden?: boolean;
  link?: string;
}

export type Run = [text: string, style: Style | null];

export const SLOTS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "bright-black",
  "bright-red",
  "bright-green",
  "bright-yellow",
  "bright-blue",
  "bright-magenta",
  "bright-cyan",
  "bright-white",
] as const;

const STAND_INS = ["--ansi-black", "--red", "--green", "--amber", "--blue", "--ansi-magenta", "--ansi-cyan", "--dim", "--faint", "--red", "--green", "--amber", "--blue", "--ansi-magenta", "--ansi-cyan", "--text"];

export const tokensOf = (slot: number) => [...new Set([`--ansi-${SLOTS[slot]}`, STAND_INS[slot]])];

export const cssOf = (slot: number) => tokensOf(slot).reduceRight((inner, token) => (inner ? `var(${token}, ${inner})` : `var(${token})`), "");

export function rgbOf(index: number): [number, number, number] {
  if (index >= 232) {
    const grey = 8 + (index - 232) * 10;
    return [grey, grey, grey];
  }
  const cube = index - 16;
  const level = (step: number) => (step ? 55 + step * 40 : 0);
  return [level(Math.floor(cube / 36)), level(Math.floor(cube / 6) % 6), level(cube % 6)];
}

const ESCAPES = /\x1b(?:\[([0-?]*)[ -/]*([@-~])|\]([^\x07\x1b]*)(?:\x07|\x1b\\|$)|[PX^_][^\x1b]*(?:\x1b\\|$)|[()*+\-./#%][\s\S]?|[\s\S]?)|\r\n|\r|\n|[\x00-\x08\x0b-\x1f\x7f]/g;
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f]/;
const PRIVATE = /[<=>?]/;

export const controlled = (text: string) => CONTROLS.test(text);

export function lines(text: string): Run[][] {
  const out: Run[][] = [[]];
  let style: Style | null = null;
  let back = false;
  let last = 0;
  const put = (piece: string) => {
    if (!piece) return;
    const line = out[out.length - 1];
    if (back) line.length = 0;
    back = false;
    const tail = line[line.length - 1];
    if (tail && tail[1] === style) tail[0] += piece;
    else line.push([piece, style]);
  };
  for (const found of text.matchAll(ESCAPES)) {
    put(text.slice(last, found.index));
    last = found.index + found[0].length;
    const [all, params, final, osc] = found;
    if (all === "\n" || all === "\r\n") {
      out.push([]);
      back = false;
    } else if (all === "\r") back = true;
    else if (params !== undefined && !PRIVATE.test(params) && final === "m") style = sgr(style, params);
    else if (params !== undefined && !PRIVATE.test(params) && final === "C") put(" ".repeat(Math.min(Number(params) || 1, 256)));
    else if (osc !== undefined && osc.startsWith("8;")) style = linked(style, osc.slice(osc.indexOf(";", 2) + 1));
  }
  put(text.slice(last));
  return out;
}

export const plain = (text: string) => (controlled(text) ? lines(text).map((line) => line.map(([piece]) => piece).join("")).join("\n") : text);

const bare = (style: Style) => (Object.keys(style) as (keyof Style)[]).every((key) => style[key] === undefined || style[key] === false);

function linked(from: Style | null, url: string): Style | null {
  const style: Style = { ...from, link: url || undefined };
  return bare(style) ? null : style;
}

const byte = (value: unknown) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 255 ? number : null;
};

function extended(kind: number, values: unknown[]): Color | undefined {
  if (kind === 5) return byte(values[0]) ?? undefined;
  if (kind !== 2) return undefined;
  const [red, green, blue] = values.slice(-3).map(byte);
  return red === null || green === null || blue === null || values.length < 3 ? undefined : [red, green, blue];
}

function sgr(from: Style | null, params: string): Style | null {
  const codes = params.split(";");
  let style: Style = { ...from };
  for (let at = 0; at < codes.length; at++) {
    const [head, ...subs] = codes[at].split(":");
    const code = head === "" ? 0 : Number(head);
    if (code === 0) style = { link: from?.link };
    else if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 3) style.italic = true;
    else if (code === 4) style.underline = subs[0] !== "0";
    else if (code === 7) style.inverse = true;
    else if (code === 8) style.hidden = true;
    else if (code === 9) style.strike = true;
    else if (code === 21) style.underline = true;
    else if (code === 22) style.bold = style.dim = false;
    else if (code === 23) style.italic = false;
    else if (code === 24) style.underline = false;
    else if (code === 27) style.inverse = false;
    else if (code === 28) style.hidden = false;
    else if (code === 29) style.strike = false;
    else if (code >= 30 && code <= 37) style.fg = code - 30;
    else if (code === 39) style.fg = undefined;
    else if (code >= 40 && code <= 47) style.bg = code - 40;
    else if (code === 49) style.bg = undefined;
    else if (code >= 90 && code <= 97) style.fg = code - 82;
    else if (code >= 100 && code <= 107) style.bg = code - 92;
    else if (code === 38 || code === 48 || code === 58) {
      let color: Color | undefined;
      if (subs.length) color = extended(Number(subs[0]), subs.slice(1));
      else {
        const kind = Number(codes[at + 1]);
        const take = kind === 5 ? 1 : kind === 2 ? 3 : 0;
        color = extended(kind, codes.slice(at + 2, at + 2 + take));
        at += 1 + take;
      }
      if (code === 38) style.fg = color;
      if (code === 48) style.bg = color;
    }
  }
  return bare(style) ? null : style;
}
