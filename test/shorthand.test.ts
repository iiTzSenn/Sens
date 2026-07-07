import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "shorthand");

describe("object shorthand references", () => {
  it("counts `{ foo }` shorthand as a use (not dead code)", async () => {
    const index = await buildIndex(fixture);
    const alpha = index.symbols.find((s) => s.name === "alpha")!;
    expect(index.references[alpha.id].length).toBeGreaterThan(0);

    const dead = new QueryEngine(index).deadCode().map((s) => s.name);
    expect(dead).not.toContain("alpha");
    expect(dead).not.toContain("beta");
  });
});
