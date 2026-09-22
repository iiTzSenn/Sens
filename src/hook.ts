import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parserForFile } from "./indexer/languages/parser.js";
import { runQuery } from "./queries.js";
import { rel } from "./paths.js";
import { loadConfig, activeRules } from "./config.js";
import { composeRules } from "./rules.js";

interface HookPayload {
  session_id?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export function sessionStartContext(root: string): string | null {
  const rules = activeRules(loadConfig(root));
  if (rules.length === 0) return null;
  return composeRules(rules);
}

interface HookAction {
  deny: boolean;
  message: string;
  once?: boolean;
}

const GREP_NUDGE =
  "sens is indexed for this project. Before grepping, its commands usually answer in one call and far fewer tokens: " +
  "`sens find <name>` (where a symbol is defined), `sens who <name>` (every call site), `sens exists <keywords>` (is it already there before you write it).";

const GLOB_NUDGE =
  "sens is indexed for this project. `sens map [subdir]` gives a compact map (files + exported symbols) to orient faster than globbing, " +
  "and `sens deps <file>` finds a file's related files.";

const isIdentifier = (s: string): boolean => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);

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
      if (!raw || !parserForFile(raw)) return null;

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

function alreadyNudged(sessionId: string, tool: string): boolean {
  const safe = sessionId.replace(/[^\w.-]+/g, "-");
  const marker = path.join(tmpdir(), `sens-hook-${safe}-${tool}`);
  if (existsSync(marker)) return true;
  try {
    writeFileSync(marker, "");
  } catch {

  }
  return false;
}

function render(action: HookAction): string {
  const hookSpecificOutput: Record<string, unknown> = {
    hookEventName: "PreToolUse",
  };
  if (action.deny) {
    hookSpecificOutput.permissionDecision = "deny";
    hookSpecificOutput.permissionDecisionReason = action.message;
  } else {
    hookSpecificOutput.additionalContext = action.message;
  }
  return JSON.stringify({ hookSpecificOutput });
}

export async function runHookPayload(root: string, raw: string): Promise<string> {
  let payload: HookPayload;
  try {
    payload = JSON.parse(raw) as HookPayload;
  } catch {
    return "";
  }

  if (payload.hook_event_name === "SessionStart") {
    let ctx: string | null = null;
    try {
      ctx = sessionStartContext(root);
    } catch {
      return "";
    }
    return ctx
      ? JSON.stringify({
          hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx },
        })
      : "";
  }

  const tool = payload.tool_name ?? "";
  let action: HookAction | null;
  try {
    action = await actionFor(root, tool, payload.tool_input ?? {});
  } catch {
    return "";
  }
  if (!action) return "";
  if (action.once && alreadyNudged(payload.session_id ?? "nosession", tool)) return "";
  return render(action);
}
