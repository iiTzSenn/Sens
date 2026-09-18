import { readFileSync } from "node:fs";
import { globby } from "globby";
import type { QueryEngine, DeadCodeReport } from "./query/engine.js";

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

const MIN_NAME = 4;
const MAX_FILE = 512 * 1024;

const simpleName = (name: string): string => name.slice(name.lastIndexOf(".") + 1);

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

      c.tier = "low";
    }
  }
  return report;
}
