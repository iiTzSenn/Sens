import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "sample");

describe("indexer", () => {
  it("extracts top-level symbols", async () => {
    const index = await buildIndex(fixture);
    const names = index.symbols.map((s) => s.name).sort();
    expect(names).toContain("add");
    expect(names).toContain("subtract");
    expect(names).toContain("unusedHelper");
    expect(names).toContain("PI");
    expect(names).toContain("main");
  });

  it("resolves cross-file references", async () => {
    const index = await buildIndex(fixture);
    const add = index.symbols.find((s) => s.name === "add")!;
    const refs = index.references[add.id];
    expect(refs.length).toBeGreaterThan(0);
    // `add` is used from app.ts
    expect(refs.some((r) => r.file.endsWith("app.ts"))).toBe(true);
  });

  it("attributes a reference to its enclosing caller", async () => {
    const index = await buildIndex(fixture);
    const add = index.symbols.find((s) => s.name === "add")!;
    const main = index.symbols.find((s) => s.name === "main")!;
    // `add` is called from inside `main`'s body — that use is attributed to main.
    // (The bare `import { add }` on line 1 is a separate module-scope use.)
    expect(index.references[add.id].some((r) => r.from === main.id)).toBe(true);
  });

  it("leaves module-level uses without a caller", async () => {
    const index = await buildIndex(fixture);
    const main = index.symbols.find((s) => s.name === "main")!;
    // `main()` is invoked at top level, so that use has no enclosing symbol.
    expect(index.references[main.id].some((r) => r.from === undefined)).toBe(true);
  });

  it("leaves unused symbols with zero references", async () => {
    const index = await buildIndex(fixture);
    const subtract = index.symbols.find((s) => s.name === "subtract")!;
    const helper = index.symbols.find((s) => s.name === "unusedHelper")!;
    expect(index.references[subtract.id]).toHaveLength(0);
    expect(index.references[helper.id]).toHaveLength(0);
  });

  it("captures a compact signature", async () => {
    const index = await buildIndex(fixture);
    const add = index.symbols.find((s) => s.name === "add")!;
    expect(add.signature).toBe("add(a: number, b: number): number");
    expect(add.exported).toBe(true);
  });
});
