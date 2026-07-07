// Reproducible benchmark suite backing the README's "Does it actually help?"
// table. Run with `npm run bench`. Every number here is measured live —
// nothing is hardcoded or estimated.

import path from "node:path";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer.js";
import { ensureIndex } from "../src/core.js";
import { QueryEngine } from "../src/query/engine.js";
import { formatMap } from "../src/format.js";
import { sensDir } from "../src/paths.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const sampleFixture = path.join(here, "..", "test", "fixtures", "sample");
const shorthandFixture = path.join(here, "..", "test", "fixtures", "shorthand");

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function benchOrientTokens() {
  console.log("\n## 1. Size to orient (project_map vs. reading all source)\n");
  const index = await buildIndex(repoRoot);
  const engine = new QueryEngine(index);
  const map = formatMap(engine.map());
  const mapChars = map.length;

  let srcChars = 0;
  for (const f of index.files) {
    srcChars += readFileSync(path.join(repoRoot, f.path), "utf8").length;
  }

  const reduction = (1 - mapChars / srcChars) * 100;
  console.log(`  project_map:        ${mapChars.toLocaleString()} chars`);
  console.log(`  full source (src):  ${srcChars.toLocaleString()} chars`);
  console.log(`  reduction:          ${reduction.toFixed(1)}%`);
  return { mapChars, srcChars, reduction };
}

async function benchReindexSpeed(runs = 5) {
  console.log(`\n## 2. Re-index speed (cold vs. cached, median of ${runs} runs)\n`);
  rmSync(sensDir(repoRoot), { recursive: true, force: true });

  const cold: number[] = [];
  for (let i = 0; i < runs; i++) {
    rmSync(sensDir(repoRoot), { recursive: true, force: true });
    const t0 = performance.now();
    await ensureIndex(repoRoot, { force: true });
    cold.push(performance.now() - t0);
  }

  const warm: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await ensureIndex(repoRoot);
    warm.push(performance.now() - t0);
  }

  const coldMs = median(cold);
  const warmMs = median(warm);
  const speedup = coldMs / warmMs;
  console.log(`  cold build (median):   ${coldMs.toFixed(1)} ms`);
  console.log(`  cached (median):       ${warmMs.toFixed(1)} ms`);
  console.log(`  speedup:               ${speedup.toFixed(1)}x`);
  return { coldMs, warmMs, speedup };
}

interface GroundTruth {
  fixture: string;
  usedNotDead: string[];
  expectedDead: string[];
}

async function benchDeadCodeAccuracy() {
  console.log("\n## 3. Dead-code accuracy (against labeled fixtures)\n");
  const cases: GroundTruth[] = [
    {
      fixture: sampleFixture,
      usedNotDead: ["add", "main", "PI"],
      expectedDead: ["subtract", "unusedHelper"],
    },
    {
      fixture: shorthandFixture,
      // alpha/beta are only referenced via `{ alpha, beta }` object shorthand.
      // `registry` itself is never imported anywhere in this isolated fixture,
      // so it's legitimately a dead-code candidate (see test/shorthand.test.ts).
      usedNotDead: ["alpha", "beta"],
      expectedDead: ["registry"],
    },
  ];

  let falsePositives = 0;
  let falseNegatives = 0;
  let totalLabels = 0;

  for (const c of cases) {
    const index = await buildIndex(c.fixture);
    const engine = new QueryEngine(index);
    const dead = new Set(engine.deadCode().map((s) => s.name));

    for (const name of c.usedNotDead) {
      totalLabels++;
      if (dead.has(name)) falsePositives++;
    }
    for (const name of c.expectedDead) {
      totalLabels++;
      if (!dead.has(name)) falseNegatives++;
    }
  }

  const fpRate = (falsePositives / totalLabels) * 100;
  console.log(`  labeled symbols checked: ${totalLabels}`);
  console.log(`  false positives:         ${falsePositives} (${fpRate.toFixed(1)}%)`);
  console.log(`  false negatives:         ${falseNegatives}`);
  return { totalLabels, falsePositives, falseNegatives };
}

async function benchDuplicationDetection() {
  console.log("\n## 4. Duplication caught before writing\n");
  const index = await buildIndex(sampleFixture);
  const engine = new QueryEngine(index);
  // Simulates: "I'm about to write a `subtract` helper" — already_exists
  // should surface the one that's already there before it gets duplicated.
  const results = engine.alreadyExists("subtract two numbers");
  const found = results.some((s) => s.name === "subtract");
  console.log(`  query: "subtract two numbers"`);
  console.log(`  existing "subtract" surfaced: ${found ? "yes" : "no"}`);
  return { found };
}

async function main() {
  const orient = await benchOrientTokens();
  const reindex = await benchReindexSpeed();
  const deadCode = await benchDeadCodeAccuracy();
  const dup = await benchDuplicationDetection();

  console.log("\n## Summary (paste into README)\n");
  console.log("| Metric | Result | How it's measured |");
  console.log("| --- | --- | --- |");
  console.log(
    `| Size to **orient** in a project | **${orient.reduction.toFixed(0)}% fewer chars** | ` +
      `project_map \u2248 ${orient.mapChars.toLocaleString()} chars vs \u2248 ${orient.srcChars.toLocaleString()} to read all of \`src/\` |`,
  );
  console.log(
    `| **Re-index** when nothing changed | **~${reindex.speedup.toFixed(0)}\u00d7 faster** | ` +
      `${reindex.coldMs.toFixed(0)} ms cold build \u2192 ${reindex.warmMs.toFixed(1)} ms from cache (median of 5 runs) |`,
  );
  console.log(
    `| **Duplication** | ${dup.found ? "caught *before* writing" : "NOT caught \u2014 regression"} | ` +
      "`already_exists` surfaces existing code |",
  );
  console.log(
    `| **Dead code** false positives | **${deadCode.falsePositives}/${deadCode.totalLabels} labeled symbols** | ` +
      "against a fixture with known used/dead/shorthand-referenced symbols |",
  );

  rmSync(sensDir(repoRoot), { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
