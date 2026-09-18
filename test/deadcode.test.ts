import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";
import { loadConfig, entryPointFiles } from "../src/config";
import { analyzeDeadCode } from "../src/deadcode";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(here, "fixtures", name);

async function engineFor(name: string): Promise<{ root: string; engine: QueryEngine }> {
  const root = fixture(name);
  const index = await buildIndex(root);
  const eps = await entryPointFiles(root, loadConfig(root));
  return { root, engine: new QueryEngine(index, eps) };
}

describe("dead-code improvements", () => {
  it("A: treats package.json `main` source as a public entry point", async () => {
    const { engine } = await engineFor("pkgentry");
    const dead = engine.deadCode().map((s) => s.name);
    expect(dead).not.toContain("publicThing");
    expect(dead).toContain("privateThing");
  });

  it("B: reports a whole unreachable module as a dead file", async () => {
    const { engine } = await engineFor("deadfile");
    const report = engine.deadCodeReport();
    expect(report.files).toContain("orphan.ts");
    expect(report.files).not.toContain("main.ts");
  });

  it("C: flags a candidate wired up by name in a non-source file", async () => {
    const { root, engine } = await engineFor("reflective");
    const report = await analyzeDeadCode(root, engine);
    const c = report.candidates.find((x) => x.symbol.name === "reflectiveHandler");
    expect(c).toBeDefined();
    expect(c?.reflectiveHit).toMatch(/config\.json/);
  });

  it("C: downgrades an otherwise-HIGH candidate found in a config file", async () => {
    const { root, engine } = await engineFor("reflective");
    const report = await analyzeDeadCode(root, engine);
    const hook = report.candidates.find((x) => x.symbol.name === "internalHook");
    expect(hook?.tier).toBe("low");
    expect(hook?.reflectiveHit).toMatch(/config\.json/);
  });

  it("D: surfaces an unused method at LOW confidence", async () => {
    const { engine } = await engineFor("methods");
    const cands = engine.deadCodeReport().candidates;
    const orphan = cands.find((c) => c.symbol.name === "Widget.orphanMethod");
    expect(orphan?.tier).toBe("low");
    expect(cands.find((c) => c.symbol.name === "Widget.helper")).toBeUndefined();
  });

  it("counts JSX tag usage (<Button/>) as a real reference", async () => {
    const { engine } = await engineFor("jsx");
    const dead = engine.deadCode().map((s) => s.name);
    expect(dead).not.toContain("Button");
    expect(dead).not.toContain("Panel");
  });

  it("counts type-only usage as a real reference", async () => {
    const { engine } = await engineFor("typeonly");
    const dead = engine.deadCode().map((s) => s.name);
    expect(dead).not.toContain("Shape");
    expect(dead).not.toContain("Handler");
  });

  it("resolves tsconfig path aliases (@/utils) when counting references", async () => {
    const { engine } = await engineFor("alias");
    const dead = engine.deadCode().map((s) => s.name);
    expect(dead).not.toContain("aliased");
  });

  it("A: reads a monorepo sub-package's package.json entry point", async () => {
    const { engine } = await engineFor("monorepo");
    const dead = engine.deadCode().map((s) => s.name);
    expect(dead).not.toContain("fooApi");
    expect(dead).toContain("fooHelper");
  });

  it("follows named and default re-exports through a barrel", async () => {
    const { engine } = await engineFor("barrel");
    const dead = engine.deadCode().map((s) => s.name);
    expect(dead).not.toContain("barreled");
    expect(dead).not.toContain("Widget");
  });

  it("scopes Python references by import to distinguish same-named symbols", async () => {
    const { engine } = await engineFor("pyscope");
    const cands = engine.deadCodeReport().candidates;
    const at = (file: string) =>
      cands.find((c) => c.symbol.name === "_helper" && c.symbol.file === file);
    expect(at("other.py")?.tier).toBe("high");
    expect(at("handlers.py")).toBeUndefined();
  });

  it("reads Kotlin visibility so private unused code reaches HIGH", async () => {
    const { engine } = await engineFor("ktscope");
    const cands = engine.deadCodeReport().candidates;
    expect(cands.find((c) => c.symbol.name === "secretHelper")?.tier).toBe("high");
    expect(cands.find((c) => c.symbol.name === "publicThing")?.tier).toBe("low");
  });

  it("excludes language-specific test files (Go _test.go) from candidates", async () => {
    const { engine } = await engineFor("goscope");
    const dead = engine.deadCode().map((s) => s.name);
    expect(dead).toContain("Unused");
    expect(dead).not.toContain("TestSomething");
  });
});
