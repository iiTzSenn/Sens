import { spawnSync } from "node:child_process";
import { nativeHookPath } from "./native.js";
import type { QueryArgs, QueryName } from "./queries.js";

const CANNOT_ANSWER = 2;

const ARGV: { [K in QueryName]: (args: QueryArgs[K]) => (string | undefined)[] } = {
  project_map: (a) => [a.subdir],
  find_symbol: (a) => [a.name],
  who_uses: (a) => [a.name, a.full ? "--full" : undefined],
  file_outline: (a) => [a.file],
  already_exists: (a) => [a.query],
  dead_code: (a) => [a.subdir],
  file_dependencies: (a) => [a.file],
  explain_symbol: (a) => [a.name],
  symbol_path: (a) => [a.from, a.to],
};

export function nativeQuery<K extends QueryName>(
  root: string,
  name: K,
  args: QueryArgs[K],
): unknown | null {
  if (process.env.SENS_NO_NATIVE === "1") return null;
  const binary = nativeHookPath();
  if (!binary) return null;

  const argv = (ARGV[name] as (a: QueryArgs[K]) => (string | undefined)[])(args);
  const result = spawnSync(
    binary,
    ["query", name, ...argv.filter((a): a is string => a !== undefined), "--json"],
    { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );

  if (result.error || result.status === CANNOT_ANSWER || result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}
