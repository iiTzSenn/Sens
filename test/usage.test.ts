import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { logUsage, readUsage, formatUsage, usagePath } from "../src/usage";

function tmpRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), "sens-usage-"));
}

describe("usage log", () => {
  it("records tool calls and reads them back", () => {
    const root = tmpRoot();
    try {
      logUsage(root, "already_exists", { query: "foo" });
      logUsage(root, "dead_code", { subdir: "src" });
      expect(existsSync(usagePath(root))).toBe(true);
      const entries = readUsage(root);
      expect(entries.map((e) => e.tool)).toEqual(["already_exists", "dead_code"]);
      expect(entries[0].args).toBe("query=foo");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("omits empty arguments from the summary", () => {
    const root = tmpRoot();
    try {
      logUsage(root, "project_map", { subdir: undefined });
      expect(readUsage(root)[0].args).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("summarizes counts per tool", () => {
    const root = tmpRoot();
    try {
      logUsage(root, "dead_code", {});
      logUsage(root, "dead_code", {});
      logUsage(root, "who_uses", { name: "x" });
      const out = formatUsage(readUsage(root));
      expect(out).toContain("3 Sens tool call(s)");
      expect(out).toContain("dead_code");
      expect(out).toContain("who_uses");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("says so when nothing has been recorded", () => {
    expect(formatUsage([])).toContain("hasn't used Sens");
  });
});
