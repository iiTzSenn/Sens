import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NATIVE_PACKAGE = `@sens-mcp/${process.platform}-${process.arch}`;

const NATIVE_BINARY = process.platform === "win32" ? "sens-hook.exe" : "sens-hook";

function fromPlatformPackage(): string | null {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve(`${NATIVE_PACKAGE}/${NATIVE_BINARY}`);
  } catch {
    return null;
  }
}

function fromLocalBuild(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = here, i = 0; i < 4; i++, dir = path.dirname(dir)) {
    const candidate = path.join(dir, "rust", "sens-hook", "target", "release", NATIVE_BINARY);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function nativeHookPath(): string | null {
  return fromPlatformPackage() ?? fromLocalBuild();
}
