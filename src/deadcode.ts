// Dead-code analysis with reflective verification.
//
// The QueryEngine reports symbols unreachable *within the indexed source*. But a
// name can still be used in files the indexer never parses — a JSON manifest, a
// YAML pipeline, an HTML template, a Markdown doc. This module runs the engine's
// report and then greps those non-source files for each candidate's name,
// annotating any that turn up so the model/user doesn't delete something wired up
// reflectively. It's the automated form of the manual "grep before deleting" step.

import { readFileSync } from "node:fs";
import { globby } from "globby";
import type { QueryEngine, DeadCodeReport } from "./query/engine.js";

/** Textual, non-source files that commonly reference symbols by name. */
const REFLECT_GLOBS = [
  "**/*.{json,jsonc,json5,yaml,yml,toml,ini,env,md,mdx,html,htm,xml,txt,graphql,gql,vue,svelte,astro,hbs,handlebars,ejs,pug,liquid,css,scss,sass,less}",
  "**/*rc",
];

const REFLECT_IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.sens/**",
  "**/.git/**",
  "**/coverage/**",
  "**/*.min.*",
];

/** Names shorter than this are too collision-prone to trust as reflective hits. */
const MIN_NAME = 4;
/** Skip files larger than this (bytes of text) to keep the scan bounded. */
const MAX_FILE = 512 * 1024;

/** The bare name to grep for — the part after the last `.` of `Class.method`. */
const simpleName = (name: string): string => name.slice(name.lastIndexOf(".") + 1);

/**
 * Find, for each candidate name, a non-source file that mentions it. Scans each
 * file once and only tracks names we care about, so cost is O(scanned tokens).
 */
async function reflectiveHits(root: string, names: Set<string>): Promise<Map<string, string>> {
  const hits = new Map<string, string>();
  if (names.size === 0) return hits;

  const files = await globby(REFLECT_GLOBS, {
    cwd: root,
    gitignore: true,
    absolute: true,
    ignore: REFLECT_IGNORE,
    dot: false,
  });

  for (const abs of files) {
    if (hits.size === names.size) break;
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (text.length > MAX_FILE) continue;
    const rel = abs.slice(root.length).replace(/\\/g, "/").replace(/^\//, "");
    for (const token of text.split(/[^A-Za-z0-9_$]+/)) {
      if (token.length < MIN_NAME) continue;
      if (names.has(token) && !hits.has(token)) hits.set(token, rel);
    }
  }
  return hits;
}

/**
 * Run the engine's dead-code report, then annotate any candidate whose name also
 * appears in a non-indexed file — a reflective-use warning that downgrades trust
 * without changing the tier (the model still decides).
 */
export async function analyzeDeadCode(
  root: string,
  engine: QueryEngine,
  subdir?: string,
): Promise<DeadCodeReport> {
  const report = engine.deadCodeReport(subdir);
  if (report.candidates.length === 0) return report;

  const names = new Set<string>();
  for (const c of report.candidates) {
    const n = simpleName(c.symbol.name);
    if (n.length >= MIN_NAME) names.add(n);
  }

  const hits = await reflectiveHits(root, names);
  if (hits.size === 0) return report;

  for (const c of report.candidates) {
    const where = hits.get(simpleName(c.symbol.name));
    if (where) {
      c.reflectiveHit = where;
      // A name that shows up in a config/manifest/template can't honestly stay
      // "high confidence, safe to remove" — reflective wiring is exactly what
      // static analysis can't see, so drop it to the verify-first tier.
      c.tier = "low";
    }
  }
  return report;
}
