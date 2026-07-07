import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "dynimport");

const refsOf = (index: Awaited<ReturnType<typeof buildIndex>>, name: string) => {
  const sym = index.symbols.find((s) => s.name === name)!;
  return index.references[sym.id] ?? [];
};

describe("dead-code false-positive coverage", () => {
  it("counts exports pulled in via a dynamic import() as used", async () => {
    const index = await buildIndex(fixture);
    const refs = refsOf(index, "lazyThing");
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((r) => r.file.endsWith("main.ts"))).toBe(true);
  });

  it("counts an export named by a string literal as used (reflective access)", async () => {
    const index = await buildIndex(fixture);
    expect(refsOf(index, "registered").length).toBeGreaterThan(0);
  });

  it("counts exports re-published through a `export * from` barrel as used", async () => {
    const index = await buildIndex(fixture);
    expect(refsOf(index, "viaStar").length).toBeGreaterThan(0);
  });

  it("still reports a genuinely unused export as having no references", async () => {
    const index = await buildIndex(fixture);
    expect(refsOf(index, "trulyUnused")).toHaveLength(0);
  });
});
