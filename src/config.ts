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

export function isTestFile(file: string): boolean {
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || /(^|\/)__tests__\//.test(file)
  );
}
