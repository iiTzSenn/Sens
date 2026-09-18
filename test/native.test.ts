import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = path.join(here, "fixtures", "sample");

function tmpProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sens-native-"));
  cpSync(sample, dir, { recursive: true });
  return dir;
}

const settingsOf = (root: string): string =>
  readFileSync(path.join(root, ".claude", "settings.json"), "utf8");

describe("native binary resolution", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../src/native.js");
  });

  it("names the platform package after process.platform and arch", async () => {
    const native = await import("../src/native");
    expect(native.NATIVE_PACKAGE).toBe(`@sens-mcp/${process.platform}-${process.arch}`);
    expect(native.NATIVE_BINARY).toBe(
      process.platform === "win32" ? "sens-hook.exe" : "sens-hook",
    );
  });

  it("recognises the platforms that get a prebuilt binary", async () => {
    const native = await import("../src/native");
    expect(native.SUPPORTED_PLATFORMS).toContain("darwin-arm64");
    expect(native.SUPPORTED_PLATFORMS).toContain("linux-x64");
    expect(native.SUPPORTED_PLATFORMS).toContain("win32-x64");
  });

  it("wires the hook to the native binary when there is one", async () => {
    const fake = path.join(os.tmpdir(), "fake-sens-hook.exe");
    vi.doMock("../src/native.js", () => ({ nativeHookPath: () => fake }));
    const { initProject } = await import("../src/init");

    const root = tmpProject();
    try {
      await initProject(root);
      expect(settingsOf(root)).toContain(JSON.stringify(fake).slice(1, -1));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("quotes a native path containing spaces", async () => {
    const fake = path.join(os.tmpdir(), "con espacios", "sens-hook.exe");
    vi.doMock("../src/native.js", () => ({ nativeHookPath: () => fake }));
    const { initProject } = await import("../src/init");

    const root = tmpProject();
    try {
      await initProject(root);
      const settings = JSON.parse(settingsOf(root));
      const command = settings.hooks.PreToolUse[0].hooks[0].command;
      expect(command.startsWith('"')).toBe(true);
      expect(command.endsWith('"')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to the node executable on an unsupported platform", async () => {
    vi.doMock("../src/native.js", () => ({ nativeHookPath: () => null }));
    const { initProject } = await import("../src/init");

    const root = tmpProject();
    try {
      await initProject(root);
      const settings = JSON.parse(settingsOf(root));
      expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe("sens-hook");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
