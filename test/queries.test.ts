import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runQuery } from "../src/queries";
import { readUsage } from "../src/usage";

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = path.join(here, "fixtures", "sample");

/** A throwaway copy of the sample fixture (runQuery writes a `.sens` cache). */
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

  it("logs every query it runs, so usage telemetry survives without MCP", async () => {
    const root = tmpProject();
    try {
      await runQuery(root, "find_symbol", { name: "add" });
      await runQuery(root, "dead_code", {});
      const tools = readUsage(root).map((e) => e.tool);
      expect(tools).toContain("find_symbol");
      expect(tools).toContain("dead_code");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
