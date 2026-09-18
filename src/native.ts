import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const NATIVE_PLATFORM = `${process.platform}-${process.arch}`;

export const NATIVE_PACKAGE = `@sens-mcp/${NATIVE_PLATFORM}`;

export const NATIVE_BINARY = process.platform === "win32" ? "sens-hook.exe" : "sens-hook";

export const SUPPORTED_PLATFORMS = [
  "win32-x64",
  "win32-arm64",
  "darwin-x64",
  "darwin-arm64",
  "linux-x64",
  "linux-arm64",
] as const;

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

export function isPlatformSupported(): boolean {
  return (SUPPORTED_PLATFORMS as readonly string[]).includes(NATIVE_PLATFORM);
}
