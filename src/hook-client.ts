import { readFileSync } from "node:fs";

export async function runHookClient(): Promise<void> {
  let raw: string;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return;
  }

  const { runHookPayload } = await import("./hook.js");
  const output = await runHookPayload(process.cwd(), raw);
  if (output) process.stdout.write(output);
}
