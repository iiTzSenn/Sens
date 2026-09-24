import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";
import darkPlus from "shiki/themes/dark-plus.mjs";

// How a stretch of code looks: a React style and a DOM style alike.
export interface Look {
  color: string;
  fontStyle?: "italic";
  fontWeight?: "bold";
  textDecoration?: "underline" | "line-through";
}

// Code colored as VS Code colors it: each line as runs of text and the look
// they take, by index into `looks`. -1 is plain text, in the page's own color.
export interface Painted {
  looks: Look[];
  lines: [string, number][][];
}

const THEME = "dark-plus";
// VS Code leaves longer lines uncolored too (editor.maxTokenizationLineLength).
const LONGEST_LINE = 20_000;
const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;
const STRIKETHROUGH = 8;

// Shiki with VS Code's Dark+ and the grammars VS Code uses, each fetched the
// first time a file needs it. The JavaScript engine needs no WebAssembly, so
// the page's CSP stays as it is.
let shiki: Promise<HighlighterCore> | null = null;
const loading = new Map<string, Promise<void>>();

const highlighter = () =>
  (shiki ??= createHighlighterCore({ themes: [darkPlus], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) }));

async function grammar(language: string) {
  const load = bundledLanguages[language as keyof typeof bundledLanguages];
  if (!load) return null;
  const ready = await highlighter();
  if (!loading.has(language)) loading.set(language, ready.loadLanguage(load));
  await loading.get(language);
  return ready;
}

export async function tokenize(text: string, language: string): Promise<Painted | null> {
  const ready = await grammar(language);
  if (!ready) return null;
  const plain = ready.getTheme(THEME).fg.toLowerCase();
  const tokens = ready.codeToTokensBase(text, { lang: language, theme: THEME, tokenizeMaxLineLength: LONGEST_LINE });

  const looks: Look[] = [];
  const known = new Map<string, number>();
  const lookOf = (color = plain, style = 0) => {
    const flags = Math.max(style, 0);
    const key = `${color.toLowerCase()}/${flags}`;
    if (key === `${plain}/0`) return -1;
    if (!known.has(key)) {
      known.set(key, looks.length);
      looks.push(lookFor(color, flags));
    }
    return known.get(key)!;
  };

  // Neighbours that look alike become one run, so fewer nodes are drawn.
  const lines = tokens.map((line) => {
    const runs: [string, number][] = [];
    for (const token of line) {
      const look = lookOf(token.color, token.fontStyle);
      const last = runs.at(-1);
      if (last && last[1] === look) last[0] += token.content;
      else runs.push([token.content, look]);
    }
    return runs;
  });
  return { looks, lines };
}

function lookFor(color: string, flags: number): Look {
  const look: Look = { color };
  if (flags & ITALIC) look.fontStyle = "italic";
  if (flags & BOLD) look.fontWeight = "bold";
  if (flags & UNDERLINE) look.textDecoration = "underline";
  else if (flags & STRIKETHROUGH) look.textDecoration = "line-through";
  return look;
}
