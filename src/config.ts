import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { globby } from "globby";

export interface SensConfig {
  /** Extra ignore globs for indexing. */
  ignore: string[];
  /** Globs of files whose exports are public API (never flagged as dead). */
  entryPoints: string[];
}

const DEFAULT_ENTRY = [
  "**/index.ts",
  "**/index.tsx",
  "**/index.js",
  "**/index.jsx",
];

export function loadConfig(root: string): SensConfig {
  const base: SensConfig = { ignore: [], entryPoints: [] };
  const p = path.join(root, "sens.config.json");
  if (!existsSync(p)) return base;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<SensConfig>;
    return {
      ignore: Array.isArray(raw.ignore) ? raw.ignore : [],
      entryPoints: Array.isArray(raw.entryPoints) ? raw.entryPoints : [],
    };
  } catch {
    return base;
  }
}

/** Files whose exports count as a public API (default + configured). */
export async function entryPointFiles(
  root: string,
  config: SensConfig,
): Promise<Set<string>> {
  const matched = await globby([...DEFAULT_ENTRY, ...config.entryPoints], {
    cwd: root,
    gitignore: true,
    absolute: false,
  });
  return new Set(matched.map((m) => m.split(path.sep).join("/")));
}

/** Directory names that hold tests, fixtures, mocks or snapshots — code that
 * lives in the repo to support tests, not to ship, so its unused symbols are
 * not dead-code candidates. */
const TEST_DIR = /(^|\/)(__tests__|__mocks__|__fixtures__|__snapshots__|tests?|specs?|fixtures|mocks|e2e)\//;

/** True for test files (`*.test.ts`, `*.spec.ts`) and anything under a test,
 * fixture, mock or snapshot directory. Paths are matched in POSIX form. */
export function isTestFile(file: string): boolean {
  const f = file.replace(/\\/g, "/");
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || TEST_DIR.test(f);
}
