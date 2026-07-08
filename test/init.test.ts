import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initProject } from "../src/init";

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = path.join(here, "fixtures", "sample");

function tmpProject(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sens-init-"));
  cpSync(sample, dir, { recursive: true });
  return dir;
}

const settingsOf = (root: string): string =>
  readFileSync(path.join(root, ".claude", "settings.json"), "utf8");

describe("sens init", () => {
  it("installs the skill and wires the hook from scratch", async () => {
    const root = tmpProject();
    try {
      const r = await initProject(root);
      expect(r.indexedFiles).toBeGreaterThan(0);
      expect(existsSync(r.skillPath)).toBe(true);
      expect(readFileSync(r.skillPath, "utf8")).toContain("name: sens");
      expect(r.hookWired).toBe("added");
      expect(settingsOf(root)).toContain("sens hook");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is idempotent — a second run does not duplicate the hook", async () => {
    const root = tmpProject();
    try {
      await initProject(root);
      const second = await initProject(root);
      expect(second.hookWired).toBe("already");
      const occurrences = settingsOf(root).split("sens hook").length - 1;
      expect(occurrences).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("merges into existing settings without clobbering other hooks", async () => {
    const root = tmpProject();
    try {
      mkdirSync(path.join(root, ".claude"), { recursive: true });
      writeFileSync(
        path.join(root, ".claude", "settings.json"),
        JSON.stringify({
          hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }] },
        }),
        "utf8",
      );
      const r = await initProject(root);
      expect(r.hookWired).toBe("added");
      const s = settingsOf(root);
      expect(s).toContain("echo hi"); // pre-existing hook preserved
      expect(s).toContain("sens hook"); // ours appended
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to clobber an unparseable settings file", async () => {
    const root = tmpProject();
    try {
      mkdirSync(path.join(root, ".claude"), { recursive: true });
      writeFileSync(path.join(root, ".claude", "settings.json"), "{ not json", "utf8");
      const r = await initProject(root);
      expect(r.hookWired).toBe("skipped");
      expect(settingsOf(root)).toBe("{ not json"); // left untouched
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
