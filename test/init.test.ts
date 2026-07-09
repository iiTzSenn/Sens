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
      const [r] = await initProject(root);
      expect(r.indexedFiles).toBeGreaterThan(0);
      expect(existsSync(r.skillPath!)).toBe(true);
      expect(readFileSync(r.skillPath!, "utf8")).toContain("name: sens");
      expect(r.hookWired).toBe("added");
      const s = settingsOf(root);
      expect(s).toContain("sens hook");
      expect(s).toContain("PreToolUse");
      expect(s).toContain("SessionStart");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is idempotent — a second run does not duplicate the hook", async () => {
    const root = tmpProject();
    try {
      await initProject(root);
      const [second] = await initProject(root);
      expect(second.hookWired).toBe("already");
      // one entry per event (PreToolUse + SessionStart), stable across runs
      const occurrences = settingsOf(root).split("sens hook").length - 1;
      expect(occurrences).toBe(2);
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
      const [r] = await initProject(root);
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
      const [r] = await initProject(root);
      expect(r.hookWired).toBe("skipped");
      expect(settingsOf(root)).toBe("{ not json"); // left untouched
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sets up a file agent (codex) with a marker-delimited, idempotent rules block", async () => {
    const root = tmpProject();
    try {
      const [first] = await initProject(root, { agent: "codex" });
      expect(first.agent).toBe("codex");
      expect(first.instructionsWritten).toBe("created");
      const file = path.join(root, "AGENTS.md");
      const body = readFileSync(file, "utf8");
      expect(body).toContain("<!-- sens:start -->");
      expect(body).toContain("sens find <name>"); // usage guide
      expect(body).toContain("Working rules"); // active rules injected
      expect(existsSync(path.join(root, ".claude"))).toBe(false); // no Claude wiring

      const [second] = await initProject(root, { agent: "codex" });
      expect(second.instructionsWritten).toBe("updated");
      const blocks = readFileSync(file, "utf8").split("<!-- sens:start -->").length - 1;
      expect(blocks).toBe(1); // refreshed in place, not duplicated
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves the user's own content around the sens block", async () => {
    const root = tmpProject();
    try {
      writeFileSync(path.join(root, "AGENTS.md"), "# My project rules\n\nBe nice.\n", "utf8");
      await initProject(root, { agent: "codex" });
      const body = readFileSync(path.join(root, "AGENTS.md"), "utf8");
      expect(body).toContain("Be nice."); // pre-existing content kept
      expect(body).toContain("<!-- sens:start -->"); // block appended
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an unknown agent", async () => {
    const root = tmpProject();
    try {
      await expect(initProject(root, { agent: "nope" })).rejects.toThrow(/unknown agent/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
