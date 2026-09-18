import { readFileSync } from "node:fs";
import { hookViaDaemon, ensureDaemon } from "./daemon/client.js";

export async function runHookClient(): Promise<void> {
  let raw: string;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return;
  }

  const root = process.cwd();
  const answer = await hookViaDaemon(root, raw);
  if (answer !== null) {
    if (answer) process.stdout.write(answer);
    return;
  }

  ensureDaemon(root);
  const { runHookPayload } = await import("./hook.js");
  const output = await runHookPayload(root, raw);
  if (output) process.stdout.write(output);
}
