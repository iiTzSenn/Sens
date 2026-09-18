import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runQuery } from "../src/queries.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const bin = path.join(here, "sens-hook", "target", "release", "sens-hook.exe");

const cases = [
  ["project_map", {}, []],
  ["project_map", { subdir: "src/cli" }, ["src/cli"]],
  ["find_symbol", { name: "buildIndex" }, ["buildIndex"]],
  ["find_symbol", { name: "BUILDINDEX" }, ["BUILDINDEX"]],
  ["find_symbol", { name: "noSuchSymbol" }, ["noSuchSymbol"]],
  ["file_outline", { file: "src/core.ts" }, ["src/core.ts"]],
  ["file_outline", { file: "core.ts" }, ["core.ts"]],
  ["already_exists", { query: "dead code" }, ["dead code"]],
  ["already_exists", { query: "index freshness" }, ["index freshness"]],
  ["file_dependencies", { file: "src/core.ts" }, ["src/core.ts"]],
  ["file_dependencies", { file: "src/types.ts" }, ["src/types.ts"]],
  ["explain_symbol", { name: "runQuery" }, ["runQuery"]],
  ["explain_symbol", { name: "loadIndex" }, ["loadIndex"]],
  ["symbol_path", { from: "runHook", to: "loadIndex" }, ["runHook", "loadIndex"]],
  ["symbol_path", { from: "runQuery", to: "noSuchSymbol" }, ["runQuery", "noSuchSymbol"]],
  ["who_uses", { name: "loadIndex" }, ["loadIndex"]],
  ["who_uses", { name: "VERSION" }, ["VERSION"]],
  ["dead_code", {}, []],
  ["dead_code", { subdir: "src" }, ["src"]],
];

const native = (name, args) =>
  execFileSync(bin, ["query", name, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).replace(/\r?\n$/, "");

let same = 0;
const differing = [];
for (const [name, args, argv] of cases) {
  const label = `${name} ${argv.join(" ")}`.trim();
  const fromNode = (await runQuery(root, name, args)).replace(/\r?\n$/, "");
  let fromRust;
  try {
    fromRust = native(name, argv);
  } catch (err) {
    fromRust = `<<exit ${err.status}>>`;
  }
  if (fromNode === fromRust) same++;
  else differing.push([label, fromNode, fromRust]);
}

console.log(`\n  consultas: ${cases.length}`);
console.log(`  idénticas: ${same}`);
console.log(`  distintas: ${differing.length}`);
for (const [label, n, r] of differing.slice(0, 4)) {
  const nl = n.split("\n");
  const rl = r.split("\n");
  console.log(`\n  ── ${label}`);
  for (let i = 0; i < Math.max(nl.length, rl.length); i++) {
    if (nl[i] !== rl[i]) {
      console.log(`     línea ${i}`);
      console.log(`       node: ${JSON.stringify(nl[i] ?? null)?.slice(0, 130)}`);
      console.log(`       rust: ${JSON.stringify(rl[i] ?? null)?.slice(0, 130)}`);
      break;
    }
  }
}
