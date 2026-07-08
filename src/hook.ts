// PreToolUse hook: when the model is about to Read / Grep / Glob, remind it —
// once per session, per tool — that sens can answer the same question in one
// call and far fewer tokens. Best-effort and non-blocking: any failure, or an
// unrecognized payload, prints nothing and lets the tool proceed untouched.
//
// Wired from a project's .claude/settings.json PreToolUse hook; reads the hook
// JSON from stdin and (optionally) writes a `hookSpecificOutput.additionalContext`
// reminder to stdout. See `sens hook` in the CLI.

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parserForFile } from "./indexer/languages/parser.js";

interface HookPayload {
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

/** The reminder for a given tool, or null when no nudge applies. */
function nudgeFor(tool: string, input: Record<string, unknown>): string | null {
  switch (tool) {
    case "Grep":
      return (
        "sens is indexed for this project. Before grepping, its tools usually answer in one call and far fewer tokens: " +
        "`find_symbol` (where a symbol is defined), `who_uses` (every call site), `already_exists` (is it already there before you write it)."
      );
    case "Glob":
      return (
        "sens is indexed for this project. `project_map` gives a compact map (files + exported symbols) to orient faster than globbing, " +
        "and `file_dependencies` finds a file's related files."
      );
    case "Read": {
      const file = typeof input.file_path === "string" ? input.file_path : "";
      // Only nudge for source files sens actually indexes.
      if (file && !parserForFile(file)) return null;
      return (
        "sens is indexed for this project. For source files, `file_outline` gives the signatures without bodies, and " +
        "`explain_symbol` gives a symbol's callers and callees — usually enough context without reading the whole file."
      );
    }
    default:
      return null;
  }
}

/** True if this session was already nudged for `tool` (and records it if not),
 * so the reminder fires at most once per session per tool. */
function alreadyNudged(sessionId: string, tool: string): boolean {
  const safe = sessionId.replace(/[^\w.-]+/g, "-");
  const marker = path.join(tmpdir(), `sens-hook-${safe}-${tool}`);
  if (existsSync(marker)) return true;
  try {
    writeFileSync(marker, "");
  } catch {
    /* best effort: if we can't record it, we may nudge again — harmless */
  }
  return false;
}

/** Read the PreToolUse payload from stdin and emit a one-off nudge, if any. */
export function runHook(): void {
  let payload: HookPayload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8")) as HookPayload;
  } catch {
    return; // not our shape / no stdin — never interfere with the tool call
  }

  const message = nudgeFor(payload.tool_name ?? "", payload.tool_input ?? {});
  if (!message) return;
  if (alreadyNudged(payload.session_id ?? "nosession", payload.tool_name ?? "")) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: message,
      },
    }),
  );
}
