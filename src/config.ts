import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { globby } from "globby";
import { BUILTIN_RULES, type RuleModule } from "./rules.js";

export interface RulesConfig {
  enabled: string[];
  disabled: string[];
  custom: RuleModule[];
}

export interface SensConfig {
  ignore: string[];
  entryPoints: string[];
  rules: RulesConfig;
}

const DEFAULT_ENTRY = [
  "**/index.ts",
  "**/index.tsx",
  "**/index.js",
  "**/index.jsx",
];

const SOURCE_EXTS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

const BUILD_DIRS = new Set(["dist", "build", "lib", "out", "es", "esm", "cjs", "umd", "types", "typings"]);

function stringLeaves(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringLeaves(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) stringLeaves(x, out);
}

function packageTargets(pkg: Record<string, unknown>): string[] {
  const targets: string[] = [];
  for (const field of ["main", "module", "types", "typings"]) stringLeaves(pkg[field], targets);
  stringLeaves(pkg.bin, targets);
  stringLeaves(pkg.exports, targets);
  return targets;
}

async function packageEntryGlobs(root: string): Promise<string[]> {
  const pkgFiles = await globby("**/package.json", {
    cwd: root,
    gitignore: true,
    absolute: false,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.sens/**"],
  });
  const globs = new Set<string>();
  for (const pkgRel of pkgFiles) {
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(readFileSync(path.join(root, pkgRel), "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const dir = path.posix.dirname(pkgRel.split(path.sep).join("/"));
    const prefix = dir === "." ? "" : `${dir}/`;
    for (const target of packageTargets(pkg)) {
      let segs = target.replace(/^\.\//, "").split("/").filter((s) => s && s !== ".");
      while (segs.length > 1 && BUILD_DIRS.has(segs[0])) segs = segs.slice(1);
      if (segs.length === 0) continue;
      const tail = segs.join("/").replace(/\.[cm]?[jt]sx?$/, "");
      globs.add(`${prefix}**/${tail}.{${SOURCE_EXTS.join(",")}}`);
    }
  }
  return [...globs];
}

const emptyRules = (): RulesConfig => ({ enabled: [], disabled: [], custom: [] });

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function parseRules(raw: unknown): RulesConfig {
  if (!raw || typeof raw !== "object") return emptyRules();
  const r = raw as Record<string, unknown>;
  const custom = Array.isArray(r.custom)
    ? r.custom.filter(
        (m): m is RuleModule =>
          !!m &&
          typeof m === "object" &&
          typeof (m as RuleModule).id === "string" &&
          typeof (m as RuleModule).title === "string" &&
          typeof (m as RuleModule).body === "string",
      ).map((m) => ({ ...m, default: (m as RuleModule).default ?? true }))
    : [];
  return { enabled: strings(r.enabled), disabled: strings(r.disabled), custom };
}

export function loadConfig(root: string): SensConfig {
  const base: SensConfig = { ignore: [], entryPoints: [], rules: emptyRules() };
  const p = path.join(root, "sens.config.json");
  if (!existsSync(p)) return base;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    return {
      ignore: strings(raw.ignore),
      entryPoints: strings(raw.entryPoints),
      rules: parseRules(raw.rules),
    };
  } catch {
    return base;
  }
}

export function ruleModules(config: SensConfig): { module: RuleModule; active: boolean }[] {
  const enabled = new Set(config.rules.enabled);
  const disabled = new Set(config.rules.disabled);
  const all = [...BUILTIN_RULES, ...config.rules.custom];
  return all.map((module) => {
    const on = disabled.has(module.id)
      ? false
      : enabled.has(module.id)
        ? true
        : module.default;
    return { module, active: on };
  });
}

export function activeRules(config: SensConfig): RuleModule[] {
  return ruleModules(config)
    .filter((r) => r.active)
    .map((r) => r.module);
}

export function setRuleState(config: SensConfig, id: string, active: boolean): RulesConfig {
  const enabled = new Set(config.rules.enabled);
  const disabled = new Set(config.rules.disabled);
  const mod = [...BUILTIN_RULES, ...config.rules.custom].find((m) => m.id === id);
  const def = mod ? mod.default : true;
  enabled.delete(id);
  disabled.delete(id);
  if (active && !def) enabled.add(id);
  if (!active && def) disabled.add(id);
  return { enabled: [...enabled], disabled: [...disabled], custom: config.rules.custom };
}

export function addCustomRule(
  config: SensConfig,
  module: { id: string; title: string; body: string },
): RulesConfig {
  const custom = config.rules.custom
    .filter((m) => m.id !== module.id)
    .concat({ id: module.id, title: module.title, body: module.body, default: true });
  return { ...config.rules, custom };
}

export function removeCustomRule(config: SensConfig, id: string): RulesConfig {
  return {
    enabled: config.rules.enabled.filter((x) => x !== id),
    disabled: config.rules.disabled.filter((x) => x !== id),
    custom: config.rules.custom.filter((m) => m.id !== id),
  };
}

export function saveRules(root: string, rules: RulesConfig): void {
  const p = path.join(root, "sens.config.json");
  let raw: Record<string, unknown> = {};
  if (existsSync(p)) {
    try {
      raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    } catch {
      raw = {};
    }
  }
  raw.rules = rules;
  writeFileSync(p, JSON.stringify(raw, null, 2) + "\n", "utf8");
}

export async function entryPointFiles(
  root: string,
  config: SensConfig,
): Promise<Set<string>> {
  const matched = await globby(
    [...DEFAULT_ENTRY, ...(await packageEntryGlobs(root)), ...config.entryPoints],
    { cwd: root, gitignore: true, absolute: false },
  );
  return new Set(matched.map((m) => m.split(path.sep).join("/")));
}

const TEST_DIR = /(^|\/)(__tests__|__mocks__|__fixtures__|__snapshots__|tests?|specs?|fixtures|mocks|e2e|testdata)\//;

const TEST_FILE = new RegExp(
  "(" +
    [
      "\\.(test|spec)\\.[cm]?[jt]sx?",
      "_test\\.(go|py|rb|exs?)",
      "_spec\\.rb",
      "(^|/)test_[^/]*\\.py",
      "(^|/)conftest\\.py",
      "(Test|Tests|Spec)\\.(java|kt|kts|cs|scala)",
    ].join("|") +
    ")$",
);
export function isTestFile(file: string): boolean {
  const f = file.replace(/\\/g, "/");
  return TEST_FILE.test(f) || TEST_DIR.test(f);
}
