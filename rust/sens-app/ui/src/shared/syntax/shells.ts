import { languageNamed, languageOf } from "./languages";

export type Shell = "bash" | "powershell" | "cmd";

export interface Nest {
  from: number;
  to: number;
  language: string;
}

export interface SessionLine {
  prompt: string;
  text: string;
  shell: Shell | null;
}

const GRAMMARS: Record<Shell, string> = { bash: "shellscript", powershell: "powershell", cmd: "bat" };
const PROMPTS: Record<Shell, string> = { bash: "$", powershell: "PS>", cmd: ">" };
const ESCAPES: Record<string, string> = { shellscript: "\\", powershell: "`", bat: "^" };
const POWERSHELLISH = /^\s*(?:&\s*)?[A-Z][a-z]+-[A-Z][A-Za-z]+\b|\$env:\w|\|\s*(?:Select|Where|ForEach|Sort|Format|Out|Measure)-[A-Z]/;

export const grammarOf = (shell: Shell) => GRAMMARS[shell];
export const promptOf = (shell: Shell) => PROMPTS[shell];

export function shellOf(tool: string, command = ""): Shell {
  if (tool === "PowerShell") return "powershell";
  if (tool === "Bash") return "bash";
  return POWERSHELLISH.test(command) ? "powershell" : "bash";
}

const LAUNCHES: { pattern: RegExp; language: string; bare: boolean }[] = [
  { pattern: /(?<![\w.-])(?:pwsh|powershell)(?:\.exe)?\b[^\n;&|]*?\s-c(?:ommand)?\s+/gi, language: "powershell", bare: true },
  { pattern: /(?<![\w.-])cmd(?:\.exe)?\s+\/{1,2}[ck]\s+/gi, language: "bat", bare: true },
  { pattern: /(?<![\w.-])(?:bash|sh|zsh)(?:\.exe)?\b[^\n;&|]*?\s-[a-z]*c\s+/g, language: "shellscript", bare: false },
  { pattern: /(?<![\w.-])(?:python3?|py)(?:\.exe)?\b[^\n;&|]*?\s-c\s+/g, language: "python", bare: false },
  { pattern: /(?<![\w.-])node(?:\.exe)?\b[^\n;&|]*?\s(?:-e|--eval|-p|--print)\s+/g, language: "javascript", bare: false },
];

const HEREDOC = /<<(-?)[ \t]*(["']?)([\w.-]+)\2[^\n]*\n/g;
const READERS: [RegExp, string][] = [
  [/(?<![\w.-])(?:python3?|py)\b/, "python"],
  [/(?<![\w.-])node\b/, "javascript"],
  [/(?<![\w.-])ruby\b/, "ruby"],
  [/(?<![\w.-])perl\b/, "perl"],
  [/(?<![\w.-])(?:pwsh|powershell)\b/, "powershell"],
  [/(?<![\w.-])(?:bash|sh|zsh)\b/, "shellscript"],
  [/(?<![\w.-])(?:psql|sqlite3|mysql)\b/, "sql"],
];
const WRITTEN = /(?:>>?|\btee(?:\s+-a)?)\s*(["']?)([^\s"'|;&<>]+)\1/;

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function readerOf(line: string) {
  const reader = READERS.find(([pattern]) => pattern.test(line));
  if (reader) return reader[1];
  const written = line.match(WRITTEN)?.[2];
  return written ? languageOf(written) : null;
}

function heredocs(text: string): Nest[] {
  const nests: Nest[] = [];
  for (const found of text.matchAll(HEREDOC)) {
    const from = found.index + found[0].length;
    if (nests.some((nest) => found.index < nest.to)) continue;
    const ending = new RegExp(`^${found[1] ? "\\t*" : ""}${escaped(found[3])}[ \\t]*$`, "m");
    const after = text.slice(from).search(ending);
    const to = after < 0 ? text.length : Math.max(from, from + after - 1);
    const line = text.slice(text.lastIndexOf("\n", found.index) + 1, from - 1);
    const language = readerOf(line);
    if (language && to > from) nests.push({ from, to, language });
  }
  return nests;
}

function argumentAt(text: string, at: number, escape: string, bare: boolean): [number, number] | null {
  const quote = text[at];
  if (quote === '"' || quote === "'") {
    let end = at + 1;
    while (end < text.length && text[end] !== quote) end += quote === '"' && text[end] === escape ? 2 : 1;
    return [at + 1, Math.min(end, text.length)];
  }
  if (!bare) return null;
  const stop = text.slice(at).search(/[\n;&|]/);
  const end = stop < 0 ? text.length : at + stop;
  return [at, at + text.slice(at, end).trimEnd().length];
}

export function nestsOf(text: string, language: string | null): Nest[] {
  if (!language || !(language in ESCAPES)) return [];
  const nests = language === "shellscript" ? heredocs(text) : [];
  for (const { pattern, language: inner, bare } of LAUNCHES) {
    for (const found of text.matchAll(pattern)) {
      const at = found.index + found[0].length;
      if (nests.some((nest) => found.index < nest.to && at > nest.from)) continue;
      const span = argumentAt(text, at, ESCAPES[language], bare);
      if (!span || span[1] <= span[0] || nests.some((nest) => span[0] < nest.to && span[1] > nest.from)) continue;
      nests.push({ from: span[0], to: span[1], language: inner });
    }
  }
  return nests.sort((one, two) => one.from - two.from);
}

const PROMPTED: [RegExp, Shell][] = [
  [/^(PS(?: [^\n>]*)?> ?)(.*)$/, "powershell"],
  [/^([A-Za-z]:\\[^\n>]*> ?)(.*)$/, "cmd"],
  [/^((?:[\w.-]+@[\w.-]+(?::[^\n$#]*)?)?\$ )(.*)$/, "bash"],
  [/^(❯ )(.*)$/, "bash"],
];
const SESSIONS = new Set(["shellscript", "powershell", "bat", "shellsession"]);
const CARRIES: Record<Shell, RegExp> = { bash: /\\$/, powershell: /`$/, cmd: /\^$/ };

function prompted(line: string): SessionLine | null {
  for (const [pattern, shell] of PROMPTED) {
    const found = line.match(pattern);
    if (found && (found[2].trim() || shell !== "bash")) return { prompt: found[1], text: found[2], shell };
  }
  return null;
}

export function sessionOf(text: string, tag = ""): SessionLine[] | null {
  const grammar = languageNamed(tag);
  if (tag.trim() && !SESSIONS.has(grammar ?? "")) return null;
  const rows = text.split("\n");
  const first = rows.find((row) => row.trim());
  if (!first || (grammar === "shellsession" ? !rows.some(prompted) : !prompted(first))) return null;
  const out: SessionLine[] = [];
  let carried: Shell | null = null;
  let last: Shell | null = null;
  for (const row of rows) {
    const line: SessionLine =
      prompted(row) ??
      (last === "powershell" && row.startsWith(">> ") ? { prompt: ">> ", text: row.slice(3), shell: last } : carried ? { prompt: "", text: row, shell: carried } : { prompt: "", text: row, shell: null });
    out.push(line);
    last = line.shell;
    carried = line.shell && CARRIES[line.shell].test(line.text) ? line.shell : null;
  }
  return out;
}
