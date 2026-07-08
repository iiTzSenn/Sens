// `sens init` — set sens up in a project in one command. This is the adoption
// path that replaces `claude mcp add`: it builds the index, installs the skill
// into `.claude/skills/`, and wires the PreToolUse hook into
// `.claude/settings.json` (merging, never clobbering existing settings).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createEngine } from "./core.js";
import { SKILL_MD, SKILL_NAME } from "./skill.js";

/** Command Claude Code runs for the hook. Assumes sens is on PATH (global install). */
const HOOK_COMMAND = "sens hook";
/** Tools the hook intercepts — the expensive read/search calls sens can answer. */
const HOOK_MATCHER = "Read|Grep|Glob";

interface HookCmd {
  type?: string;
  command?: string;
}
interface HookEntry {
  matcher?: string;
  hooks?: HookCmd[];
}
interface Settings {
  hooks?: { PreToolUse?: HookEntry[] } & Record<string, unknown>;
  [key: string]: unknown;
}

export interface InitResult {
  indexedFiles: number;
  skillPath: string;
  hookWired: "added" | "already" | "skipped";
  settingsPath: string;
}

/** True if some PreToolUse entry already runs the sens hook. */
function hasSensHook(pre: HookEntry[]): boolean {
  return pre.some(
    (entry) =>
      Array.isArray(entry.hooks) &&
      entry.hooks.some((h) => typeof h.command === "string" && h.command.includes("sens hook")),
  );
}

/** Merge the sens PreToolUse hook into settings.json without touching anything else. */
function wireHook(settingsPath: string): InitResult["hookWired"] {
  let settings: Settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Settings;
    } catch {
      return "skipped"; // unparseable — never risk clobbering the user's settings
    }
  } else {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
  }

  settings.hooks = settings.hooks ?? {};
  const pre = (settings.hooks.PreToolUse = settings.hooks.PreToolUse ?? []);
  if (hasSensHook(pre)) return "already";

  pre.push({ matcher: HOOK_MATCHER, hooks: [{ type: "command", command: HOOK_COMMAND }] });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return "added";
}

/** Install sens into a project: build the index, drop the skill, wire the hook. */
export async function initProject(root: string): Promise<InitResult> {
  const { index } = await createEngine(root, { force: true });

  const skillDir = path.join(root, ".claude", "skills", SKILL_NAME);
  mkdirSync(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, "SKILL.md");
  writeFileSync(skillPath, SKILL_MD, "utf8");

  const settingsPath = path.join(root, ".claude", "settings.json");
  const hookWired = wireHook(settingsPath);

  return { indexedFiles: index.files.length, skillPath, hookWired, settingsPath };
}
