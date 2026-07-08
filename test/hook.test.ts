import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { actionFor } from "../src/hook";

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = path.join(here, "fixtures", "sample");

function tmpProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sens-hook-"));
  cpSync(sample, dir, { recursive: true });
  return dir;
}

describe("hook actionFor", () => {
  it("substitutes a grep for a known symbol with its usages", async () => {
    const root = tmpProject();
    try {
      const a = await actionFor(root, "Grep", { pattern: "add" });
      expect(a?.deny).toBe(true);
      expect(a?.message).toContain("add");
      expect(a?.message).toMatch(/use\(s\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets a regex grep run and only reminds (once per session)", async () => {
    const root = tmpProject();
    try {
      const a = await actionFor(root, "Grep", { pattern: "add.*PI" });
      expect(a?.deny).toBe(false);
      expect(a?.once).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets a grep for an unknown identifier run", async () => {
    const root = tmpProject();
    try {
      const a = await actionFor(root, "Grep", { pattern: "noSuchSymbolXyz" });
      expect(a?.deny).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("injects a file outline before reading a source file (absolute path)", async () => {
    const root = tmpProject();
    try {
      // Claude Code passes an absolute path — the index is keyed root-relative.
      const a = await actionFor(root, "Read", { file_path: path.join(root, "math.ts") });
      expect(a?.deny).toBe(false);
      expect(a?.message).toContain("add");
      expect(a?.message).toContain("outline");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores reads of non-source files", async () => {
    const root = tmpProject();
    try {
      const a = await actionFor(root, "Read", { file_path: path.join(root, "notes.md") });
      expect(a).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
