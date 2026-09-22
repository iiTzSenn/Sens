import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runQuery } from "../src/queries";

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = path.join(here, "fixtures", "sample");

function tmpProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sens-queries-"));
  cpSync(sample, dir, { recursive: true });
  return dir;
}

describe("runQuery", () => {
  it("formats a find_symbol result", async () => {
    const root = tmpProject();
    try {
      const out = await runQuery(root, "find_symbol", { name: "add" });
      expect(out).toContain("math.ts");
      expect(out).toContain("add");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("surfaces an unused export via dead_code", async () => {
    const root = tmpProject();
    try {
      const out = await runQuery(root, "dead_code", {});
      expect(out).toContain("subtract");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
