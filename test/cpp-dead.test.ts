import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";
import type { ProjectIndex } from "../src/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "cppdead");

// One shared build: loading the tree-sitter C++ grammar is the expensive part.
let index: ProjectIndex;
async function getIndex(): Promise<ProjectIndex> {
  if (!index) index = await buildIndex(fixture);
  return index;
}

async function candidates() {
  return new QueryEngine(await getIndex()).deadCodeReport().candidates;
}

describe("C++ dead-code accuracy", () => {
  it("(a) flags an internal-linkage unused function at HIGH", async () => {
    const cands = await candidates();
    const staticFn = cands.find((c) => c.symbol.name === "staticUnused");
    const anonFn = cands.find((c) => c.symbol.name === "anonUnused");
    // static / anonymous-namespace linkage is internal — treated as not exported
    // so an unused one reaches HIGH instead of being capped at LOW.
    expect(staticFn?.tier).toBe("high");
    expect(staticFn?.symbol.exported).toBe(false);
    expect(anonFn?.tier).toBe("high");
    expect(anonFn?.symbol.exported).toBe(false);
  });

  it("(b) surfaces a public unused function at LOW", async () => {
    const cands = await candidates();
    const pub = cands.find((c) => c.symbol.name === "publicUnused");
    expect(pub?.tier).toBe("low");
    expect(pub?.symbol.exported).toBe(true);
  });

  it("(c) never flags live code (no false positives)", async () => {
    const names = (await candidates()).map((c) => c.symbol.name);
    expect(names).not.toContain("main");         // program entry point
    expect(names).not.toContain("Shape.area");   // virtual base, used
    expect(names).not.toContain("Circle.area");  // override, used on an instance
    expect(names).not.toContain("Circle.render"); // plain instance method, used
    expect(names).not.toContain("usedHelper");   // defined in util.cpp, used in main.cpp
    expect(names).not.toContain("maxOf");        // template, instantiated + used
  });

  it("resolves #include \"util.hpp\" to the project file for the import graph", async () => {
    const imports = (await getIndex()).imports;
    expect(
      imports.some((e) => e.from === "main.cpp" && e.to === "util.hpp"),
    ).toBe(true);
  });
});
