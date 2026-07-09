// `sens init [--agent <name>]` — set sens up in a project for a given agent.
//
//  - claude  → build index, install the skill, wire the PreToolUse + SessionStart
//              hooks into `.claude/settings.json` (merging, never clobbering).
//  - codex / copilot / cursor → build index, write the sens usage guide + the
//              project's active rules into that agent's instructions file
//              (AGENTS.md / .github/copilot-instructions.md / .cursorrules), between
//              markers so re-running just refreshes the block.
//  - all     → every agent above.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createEngine } from "./core.js";
import { loadConfig, activeRules } from "./config.js";
import { composeRules } from "./rules.js";
import { SKILL_MD, SKILL_NAME, sensInstructions } from "./skill.js";

/** Command Claude Code runs for the hooks. Assumes sens is on PATH (global install). */
const HOOK_COMMAND = "sens hook";
/** Tools the PreToolUse hook intercepts. */
const HOOK_MATCHER = "Read|Grep|Glob";

/** Agents whose setup is just an instructions file (they drive the CLI from it). */
const FILE_AGENTS: Record<string, { label: string; file: string }> = {
  codex: { label: "Codex", file: "AGENTS.md" },
  copilot: { label: "GitHub Copilot", file: path.join(".github", "copilot-instructions.md") },
  cursor: { label: "Cursor", file: ".cursorrules" },
};

interface HookCmd {
  type?: string;
  command?: string;
}
interface HookEntry {
  matcher?: string;
  hooks?: HookCmd[];
}
interface Settings {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

export interface InitResult {
  agent: string;
  indexedFiles: number;
  // claude
  skillPath?: string;
  settingsPath?: string;
  hookWired?: "added" | "already" | "skipped";
  // file agents
  instructionsPath?: string;
  instructionsWritten?: "created" | "updated";
}

/** Which agents a `--agent` value maps to. */
function resolveTargets(agent: string): string[] {
  if (agent === "all") return ["claude", ...Object.keys(FILE_AGENTS)];
  if (agent === "claude" || agent in FILE_AGENTS) return [agent];
  throw new Error(`unknown agent "${agent}" — use one of: claude, codex, copilot, cursor, all`);
}

/** True if some entry in this event's list already runs the sens hook. */
function hasSensHook(entries: HookEntry[]): boolean {
  return entries.some(
    (entry) =>
      Array.isArray(entry.hooks) &&
      entry.hooks.some((h) => typeof h.command === "string" && h.command.includes("sens hook")),
  );
}

/** Add the sens hook to one event's list if absent; returns whether it was added. */
function addSensHook(hooks: Record<string, HookEntry[]>, event: string, matcher?: string): boolean {
  const entries = (hooks[event] = hooks[event] ?? []);
  if (hasSensHook(entries)) return false;
  const entry: HookEntry = { hooks: [{ type: "command", command: HOOK_COMMAND }] };
  if (matcher) entry.matcher = matcher;
  entries.push(entry);
  return true;
}

/** Merge the sens hooks (PreToolUse + SessionStart) into settings.json, untouched otherwise. */
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

  const hooks = (settings.hooks = settings.hooks ?? {});
  const addedPre = addSensHook(hooks, "PreToolUse", HOOK_MATCHER);
  const addedStart = addSensHook(hooks, "SessionStart");
  if (!addedPre && !addedStart) return "already";

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return "added";
}

const MARK_START = "<!-- sens:start -->";
const MARK_END = "<!-- sens:end -->";
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Write the sens block into an instructions file, replacing a prior block if present. */
function writeInstructions(file: string, body: string): "created" | "updated" {
  const block = `${MARK_START}\n${body}\n${MARK_END}`;
  if (existsSync(file)) {
    const cur = readFileSync(file, "utf8");
    if (cur.includes(MARK_START) && cur.includes(MARK_END)) {
      const re = new RegExp(`${escapeRe(MARK_START)}[\\s\\S]*?${escapeRe(MARK_END)}`);
      writeFileSync(file, cur.replace(re, block), "utf8");
    } else {
      writeFileSync(file, `${cur.trimEnd()}\n\n${block}\n`, "utf8");
    }
    return "updated";
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${block}\n`, "utf8");
  return "created";
}

/** Claude Code setup: skill + hooks. */
function initClaude(root: string, indexedFiles: number): InitResult {
  const skillDir = path.join(root, ".claude", "skills", SKILL_NAME);
  mkdirSync(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, "SKILL.md");
  writeFileSync(skillPath, SKILL_MD, "utf8");

  const settingsPath = path.join(root, ".claude", "settings.json");
  return { agent: "claude", indexedFiles, skillPath, settingsPath, hookWired: wireHook(settingsPath) };
}

/** File-agent setup: write the guide + active rules into the agent's instructions file. */
function initFileAgent(root: string, id: string, indexedFiles: number): InitResult {
  const body = sensInstructions(composeRules(activeRules(loadConfig(root))));
  const file = path.join(root, FILE_AGENTS[id].file);
  return { agent: id, indexedFiles, instructionsPath: file, instructionsWritten: writeInstructions(file, body) };
}

/** Install sens into a project for one or more agents. Builds the index once. */
export async function initProject(root: string, opts: { agent?: string } = {}): Promise<InitResult[]> {
  const targets = resolveTargets(opts.agent ?? "claude");
  const { index } = await createEngine(root, { force: true });
  return targets.map((t) =>
    t === "claude" ? initClaude(root, index.files.length) : initFileAgent(root, t, index.files.length),
  );
}
