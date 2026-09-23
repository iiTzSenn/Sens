import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const bin = path.join(here, "sens-hook", "target", "release", process.platform === "win32" ? "sens-hook.exe" : "sens-hook");

const normalize = (o) => ({
  symbols: o.symbols
    .map((s) => `${s.file}:${s.line} ${s.kind} ${s.name}${s.exported ? " [exp]" : ""}${s.entry ? " [entry]" : ""} | ${s.signature}`)
    .sort(),
  exports: o.files.flatMap((f) => (f.exports ?? []).map((e) => `${f.path}:${e}`)).sort(),
  imports: o.imports.map((i) => `${i.from} -> ${i.to}`).sort(),
  references: Object.entries(o.references)
    .flatMap(([id, refs]) => refs.map((r) => `${id} <- ${r.file}:${r.line}${r.from ? ` in ${r.from}` : ""}`))
    .sort(),
});

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["godead", "goscope"];

console.log("");
console.log("  fixture     símbolos  exports  imports  referencias");
console.log("  " + "-".repeat(52));

let failures = 0;
for (const name of targets) {
  const root = path.join(repo, "test", "fixtures", name);
  if (!existsSync(root)) continue;

  const node = normalize(await buildIndex(root));
  let rust;
  try {
    rust = normalize(JSON.parse(execFileSync(bin, ["index"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })));
  } catch (err) {
    console.log(`  ${name.padEnd(11)} <<no indexó: exit ${err.status}>>`);
    failures++;
    continue;
  }

  const cells = [];
  let bad = false;
  for (const field of ["symbols", "exports", "imports", "references"]) {
    const a = new Set(node[field]);
    const b = new Set(rust[field]);
    const missing = [...a].filter((x) => !b.has(x));
    const extra = [...b].filter((x) => !a.has(x));
    if (missing.length || extra.length) bad = true;
    cells.push(a.size === 0 && b.size === 0 ? "   ok " : `${missing.length ? `-${missing.length}` : ""}${extra.length ? `+${extra.length}` : ""}` || "   ok ");
    if (missing.length || extra.length) {
      for (const m of missing.slice(0, 3)) console.log(`     falta ${field}: ${m}`);
      for (const x of extra.slice(0, 3)) console.log(`     sobra ${field}: ${x}`);
    }
  }
  if (bad) failures++;
  console.log(`  ${name.padEnd(11)} ${cells.map((c) => c.padStart(7)).join("  ")}${bad ? "" : "   IGUAL"}`);
}

console.log(`\n  fixtures con diferencias: ${failures}`);
