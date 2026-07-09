import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";

const here = path.dirname(fileURLToPath(import.meta.url));

async function candidates() {
  const index = await buildIndex(path.join(here, "fixtures", "rubydead"));
  return new QueryEngine(index).deadCodeReport().candidates;
}

describe("ruby dead-code", () => {
  it("flags an unused top-level method as a candidate", async () => {
    const cands = await candidates();
    const dead = cands.find((c) => c.symbol.name === "unused_top_level");
    expect(dead).toBeDefined();
    expect(dead?.symbol.file).toBe("models.rb");
    // Top-level methods stay exported (globally reachable via require/autoload),
    // so an unused one surfaces conservatively at LOW, never as a false HIGH.
    expect(dead?.tier).toBe("low");
  });

  it("never flags live code (no false positives)", async () => {
    const flagged = new Set((await candidates()).map((c) => c.symbol.name));
    // class instantiated via `.new`
    expect(flagged.has("Widget")).toBe(false);
    // base class reached only through `class Widget < Base` inheritance
    expect(flagged.has("Base")).toBe(false);
    // module reached only through `include Greeting`
    expect(flagged.has("Greeting")).toBe(false);
    // methods called on an instance / via the mixin
    expect(flagged.has("Widget.render")).toBe(false);
    expect(flagged.has("Base.shared")).toBe(false);
    expect(flagged.has("Greeting.hello")).toBe(false);
    // a top-level method that IS called
    expect(flagged.has("used_top_level")).toBe(false);
    // the class whose body drives everything
    expect(flagged.has("App")).toBe(false);
  });
});
