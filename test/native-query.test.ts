import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

describe("native query client", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../src/native.js");
    delete process.env.SENS_NO_NATIVE;
  });

  it("stands down when the user opted out", async () => {
    process.env.SENS_NO_NATIVE = "1";
    const { nativeQuery } = await import("../src/native-query");
    expect(nativeQuery(process.cwd(), "find_symbol", { name: "x" })).toBeNull();
  });

  it("stands down when there is no binary", async () => {
    vi.doMock("../src/native.js", () => ({ nativeHookPath: () => null }));
    const { nativeQuery } = await import("../src/native-query");
    expect(nativeQuery(process.cwd(), "find_symbol", { name: "x" })).toBeNull();
  });

  it("stands down when the binary cannot answer", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sens-nq-"));
    const fake = path.join(dir, process.platform === "win32" ? "nope.cmd" : "nope.sh");
    writeFileSync(fake, process.platform === "win32" ? "@exit /b 2\r\n" : "#!/bin/sh\nexit 2\n", {
      mode: 0o755,
    });
    vi.doMock("../src/native.js", () => ({ nativeHookPath: () => fake }));
    try {
      const { nativeQuery } = await import("../src/native-query");
      expect(nativeQuery(process.cwd(), "find_symbol", { name: "x" })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stands down rather than throwing on unparseable output", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "sens-nq-"));
    const fake = path.join(dir, process.platform === "win32" ? "junk.cmd" : "junk.sh");
    writeFileSync(fake, process.platform === "win32" ? "@echo not json\r\n" : "#!/bin/sh\necho not json\n", {
      mode: 0o755,
    });
    vi.doMock("../src/native.js", () => ({ nativeHookPath: () => fake }));
    try {
      const { nativeQuery } = await import("../src/native-query");
      expect(nativeQuery(process.cwd(), "find_symbol", { name: "x" })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes --full through for who_uses", async () => {
    const seen: string[][] = [];
    vi.doMock("node:child_process", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:child_process")>()),
      spawnSync: (_bin: string, argv: string[]) => {
        seen.push(argv);
        return { status: 0, stdout: "[]", error: undefined };
      },
    }));
    vi.doMock("../src/native.js", () => ({ nativeHookPath: () => "irrelevant" }));
    const { nativeQuery } = await import("../src/native-query");

    nativeQuery(process.cwd(), "who_uses", { name: "x", full: true });
    nativeQuery(process.cwd(), "who_uses", { name: "x" });
    expect(seen[0]).toEqual(["query", "who_uses", "x", "--full", "--json"]);
    expect(seen[1]).toEqual(["query", "who_uses", "x", "--json"]);
  });

  it("omits an absent optional argument instead of sending undefined", async () => {
    const seen: string[][] = [];
    vi.doMock("node:child_process", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:child_process")>()),
      spawnSync: (_bin: string, argv: string[]) => {
        seen.push(argv);
        return { status: 0, stdout: "[]", error: undefined };
      },
    }));
    vi.doMock("../src/native.js", () => ({ nativeHookPath: () => "irrelevant" }));
    const { nativeQuery } = await import("../src/native-query");

    nativeQuery(process.cwd(), "dead_code", {});
    expect(seen[0]).toEqual(["query", "dead_code", "--json"]);
  });
});
