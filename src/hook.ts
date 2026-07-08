// PreToolUse hook: when the model is about to Read / Grep / Glob, answer with
// sens *before* the expensive call runs.
//
//  - Grep for a symbol sens knows  -> deny the grep and return `who_uses` (the
//    definition + every call site). sens replaces grep for the common case.
//  - Grep for anything else (regex, a string, an unknown name) -> let it run,
//    just remind that sens exists.
//  - Read of an indexed source file -> inject the file's outline (signatures
//    only) as context; the read still proceeds, but often it isn't needed.
//  - Glob -> remind that `project_map` / `file_dependencies` orient faster.
//
// Best-effort and non-blocking by default: any failure, or an unrecognized
// payload, emits nothing and lets the tool proceed untouched. Wired from a
// project's .claude/settings.json PreToolUse hook; see `sens hook` in the CLI.

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parserForFile } from "./indexer/languages/parser.js";
import { runQuery } from "./queries.js";
import { rel } from "./paths.js";

interface HookPayload {
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

/** What the hook decided to do about a tool call. */
interface HookAction {
  /** Deny the tool call (substitute it) instead of just adding context. */
  deny: boolean;
  /** Text handed to the model — the sens answer, or a reminder. */
  message: string;
  /** Generic reminder: fire at most once per session per tool, to avoid spam.
   * Specific answers (a real outline / usage list) fire every time. */
  once?: boolean;
}

const GREP_NUDGE =
  "sens is indexed for this project. Before grepping, its commands usually answer in one call and far fewer tokens: " +
  "`sens find <name>` (where a symbol is defined), `sens who <name>` (every call site), `sens exists <keywords>` (is it already there before you write it).";

const GLOB_NUDGE =
  "sens is indexed for this project. `sens map [subdir]` gives a compact map (files + exported symbols) to orient faster than globbing, " +
  "and `sens deps <file>` finds a file's related files.";

/** A bare symbol name (what a symbol-hunting grep looks like), not a regex. */
const isIdentifier = (s: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);

/** Decide what to do for a tool call, running a sens query when it can answer. */
export async function actionFor(
  root: string,
  tool: string,
  input: Record<string, unknown>,
): Promise<HookAction | null> {
  switch (tool) {
    case "Grep": {
      const pattern = typeof input.pattern === "string" ? input.pattern : "";
      if (isIdentifier(pattern)) {
        const answer = await runQuery(root, "who_uses", { name: pattern });
        if (!answer.startsWith("symbol not found")) {
          return {
            deny: true,
            message:
              `sens answered this without a grep — \`${pattern}\` (definition + every use):\n\n${answer}\n\n` +
              "If you actually meant a text/regex search rather than this symbol, run the search again with a pattern that isn't a bare identifier.",
          };
        }
      }
      return { deny: false, message: GREP_NUDGE, once: true };
    }
    case "Read": {
      const raw = typeof input.file_path === "string" ? input.file_path : "";
      if (!raw || !parserForFile(raw)) return null; // not a source file sens indexes
      // Claude Code passes an absolute path; the index matches root-relative POSIX.
      const file = path.isAbsolute(raw) ? rel(root, raw) : raw;
      const outline = await runQuery(root, "file_outline", { file });
      if (outline.startsWith("no matches")) return null;
      return {
        deny: false,
        message:
          "sens outline of this file (signatures only) — often enough without reading the whole file:\n\n" +
          outline,
      };
    }
    case "Glob":
      return { deny: false, message: GLOB_NUDGE, once: true };
    default:
      return null;
  }
}

/** True if this session was already reminded for `tool` (and records it if not),
 * so generic reminders fire at most once per session per tool. */
function alreadyNudged(sessionId: string, tool: string): boolean {
  const safe = sessionId.replace(/[^\w.-]+/g, "-");
  const marker = path.join(tmpdir(), `sens-hook-${safe}-${tool}`);
  if (existsSync(marker)) return true;
  try {
    writeFileSync(marker, "");
  } catch {
    /* best effort: if we can't record it, we may remind again — harmless */
  }
  return false;
}

/** Emit the hook's decision as PreToolUse JSON on stdout. */
function emit(action: HookAction): void {
  const hookSpecificOutput: Record<string, unknown> = {
    hookEventName: "PreToolUse",
  };
  if (action.deny) {
    hookSpecificOutput.permissionDecision = "deny";
    hookSpecificOutput.permissionDecisionReason = action.message;
  } else {
    hookSpecificOutput.additionalContext = action.message;
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
}

/** Read the PreToolUse payload from stdin and answer with sens, if we can. */
export async function runHook(): Promise<void> {
  let payload: HookPayload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8")) as HookPayload;
  } catch {
    return; // not our shape / no stdin — never interfere with the tool call
  }

  const tool = payload.tool_name ?? "";
  let action: HookAction | null;
  try {
    action = await actionFor(process.cwd(), tool, payload.tool_input ?? {});
  } catch {
    return; // a sens failure must never break the tool call
  }
  if (!action) return;
  if (action.once && alreadyNudged(payload.session_id ?? "nosession", tool)) return;
  emit(action);
}
