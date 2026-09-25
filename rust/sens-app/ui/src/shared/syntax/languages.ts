import { byName } from "../fileIcons";
import table from "./languages.json";

const names: Record<string, string> = table.names;
const extensions: Record<string, string> = table.extensions;
const aliases: Record<string, string> = table.aliases;
const interpreters: Record<string, string> = table.interpreters;
const titles: Record<string, string> = table.titles;
const SHELL_TITLES: Record<string, string> = { bash: "Bash", zsh: "Zsh", cmd: "CMD" };

// `#!/usr/bin/env python3`, `#!/bin/bash -e`: the program, without its version.
const SHEBANG = /^#!\s*(?:\S*\/)?(?:env\s+(?:-\S+\s+)*)?([\w.+-]+)/;

// The grammar VS Code would color a file with: by its name, else by the
// program its first line runs. scripts/languages.mjs writes the table.
export function languageOf(path: string, text = "") {
  const named = byName(path, names, extensions);
  if (named) return named;
  const program = text.match(SHEBANG)?.[1];
  if (!program) return null;
  return interpreters[program] ?? interpreters[program.replace(/[\d.]+$/, "")] ?? null;
}

// The grammar a code fence names: ```ts, ```python, ```console, ```ps1.
export function languageNamed(tag: string) {
  const name = tag.trim().toLowerCase();
  if (!name) return null;
  return (Object.hasOwn(aliases, name) ? aliases[name] : undefined) ?? byName(`.${name}`, {}, extensions) ?? null;
}

export function titleOf(tag: string) {
  const name = tag.trim().toLowerCase();
  if (Object.hasOwn(SHELL_TITLES, name)) return SHELL_TITLES[name];
  const grammar = languageNamed(name);
  return grammar && Object.hasOwn(titles, grammar) ? titles[grammar] : null;
}
