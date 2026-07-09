import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUILTIN_RULES, composeRules, AGENT_RULES } from "../src/rules";
import { loadConfig, activeRules, ruleModules } from "../src/config";
import { sessionStartContext } from "../src/hook";

/** A tmp project root, optionally seeded with a sens.config.json. */
function tmpRoot(cfg?: object): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sens-rules-"));
  if (cfg) writeFileSync(path.join(dir, "sens.config.json"), JSON.stringify(cfg), "utf8");
  return dir;
}
const idsOf = (root: string): string[] => activeRules(loadConfig(root)).map((m) => m.id);

describe("rule modules", () => {
  it("composeRules renders a heading per module", () => {
    const out = composeRules(BUILTIN_RULES.slice(0, 2));
    expect(out).toContain(`## ${BUILTIN_RULES[0].title}`);
    expect(out).toContain(`## ${BUILTIN_RULES[1].title}`);
  });

  it("AGENT_RULES carries the default-on modules and omits default-off ones", () => {
    expect(AGENT_RULES).toContain("search first, write second");
    expect(AGENT_RULES).toContain("Optimize what matters");
    expect(AGENT_RULES).not.toContain("Cover new behavior with tests"); // default off
  });

  it("defaults to the default-on modules", () => {
    const root = tmpRoot();
    try {
      expect(idsOf(root)).toContain("search-first");
      expect(idsOf(root)).not.toContain("testing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("disable turns a default-on module off; enable turns a default-off one on", () => {
    const root = tmpRoot({ rules: { disabled: ["optimization"], enabled: ["testing"] } });
    try {
      const ids = idsOf(root);
      expect(ids).not.toContain("optimization");
      expect(ids).toContain("testing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes custom modules (on by default)", () => {
    const root = tmpRoot({
      rules: { custom: [{ id: "team", title: "Team rule", body: "- do it our way" }] },
    });
    try {
      const team = ruleModules(loadConfig(root)).find((m) => m.module.id === "team");
      expect(team?.active).toBe(true);
      expect(idsOf(root)).toContain("team");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sessionStartContext returns the active rules, or null when all are off", () => {
    const on = tmpRoot();
    const off = tmpRoot({ rules: { disabled: BUILTIN_RULES.map((m) => m.id) } });
    try {
      expect(sessionStartContext(on)).toContain("Working rules");
      expect(sessionStartContext(off)).toBeNull();
    } finally {
      rmSync(on, { recursive: true, force: true });
      rmSync(off, { recursive: true, force: true });
    }
  });
});
