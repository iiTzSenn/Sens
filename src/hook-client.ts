// Slim entry point for the PreToolUse hook.
//
// `sens hook` runs once per Read/Grep/Glob the model makes, and the dominant
// cost of a one-shot node process is not the work — it is getting to the work.
// Loading the full CLI bundle (commander, the renderers, the indexer graph)
// costs ~100ms before a single line of hook logic runs.
//
// So this module imports almost nothing. It reads the payload, hands it to the
// resident daemon — which has the engine warm and runs the *same* hook logic —
// and writes back what the daemon produced. Only when there is no daemon does
// it pull in the real implementation, and then start one for next time.
//
// Anything unexpected exits silently: a hook that fails must never break the
// tool call it was inspecting.

import { readFileSync } from "node:fs";
import { hookViaDaemon, ensureDaemon } from "./daemon/client.js";

export async function runHookClient(): Promise<void> {
  let raw: string;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return; // no stdin — nothing to answer
  }

  const root = process.cwd();
  const answer = await hookViaDaemon(root, raw);
  if (answer !== null) {
    if (answer) process.stdout.write(answer);
    return;
  }

  // No daemon: do it here (the expensive path), and leave one running so the
  // next tool call takes the fast route.
  ensureDaemon(root);
  const { runHookPayload } = await import("./hook.js");
  const output = await runHookPayload(root, raw);
  if (output) process.stdout.write(output);
}
