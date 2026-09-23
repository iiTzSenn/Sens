import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const rustBin = path.join(here, "sens-hook", "target", "release", process.platform === "win32" ? "sens-hook.exe" : "sens-hook");
const nodeHook = path.join(root, "dist", "hook.js");

const run = (cmd, args, input) => {
  try {
    return execFileSync(cmd, args, {
      input,
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, SENS_NO_DAEMON: "1", SENS_NODE_HOOK: nodeHook },
    });
  } catch (err) {
    return `<<error: ${err.message}>>`;
  }
};

const payloads = [];
const srcFiles = readdirSync(path.join(root, "src")).filter((f) => f.endsWith(".ts"));

for (const name of ["buildIndex", "runQuery", "QueryEngine", "loadIndex", "isFresh", "formatWhoUses", "render", "decide"]) {
  payloads.push({ label: `Grep ${name}`, body: { tool_name: "Grep", tool_input: { pattern: name } } });
}
payloads.push({ label: "Grep regex", body: { tool_name: "Grep", tool_input: { pattern: "foo.*bar" } } });
payloads.push({ label: "Grep desconocido", body: { tool_name: "Grep", tool_input: { pattern: "zzzNoExiste" } } });
for (const f of srcFiles.slice(0, 8)) {
  payloads.push({ label: `Read src/${f}`, body: { tool_name: "Read", tool_input: { file_path: path.join(root, "src", f) } } });
}
payloads.push({ label: "Read no indexado", body: { tool_name: "Read", tool_input: { file_path: path.join(root, "README.md") } } });
payloads.push({ label: "Glob", body: { tool_name: "Glob", tool_input: { pattern: "**/*.ts" } } });
payloads.push({ label: "herramienta ajena", body: { tool_name: "Bash", tool_input: { command: "ls" } } });
payloads.push({ label: "payload vacío", body: {} });

let same = 0, delegated = 0, differing = [];
for (const p of payloads) {
  const input = JSON.stringify({ hook_event_name: "PreToolUse", session_id: "difftest", ...p.body });
  const fromNode = run("node", [nodeHook], input);
  const fromRust = run(rustBin, [], input);
  if (fromRust === fromNode) {
    same++;
    if (fromRust === "") delegated++;
  } else differing.push([p.label, fromNode, fromRust]);
}

console.log(`\n  payloads: ${payloads.length}`);
console.log(`  idénticos: ${same}   (${delegated} con salida vacía por ambos lados)`);
console.log(`  distintos: ${differing.length}`);
for (const [label, n, r] of differing.slice(0, 6)) {
  console.log(`\n  ── ${label}`);
  console.log(`    node: ${JSON.stringify(n).slice(0, 220)}`);
  console.log(`    rust: ${JSON.stringify(r).slice(0, 220)}`);
}
