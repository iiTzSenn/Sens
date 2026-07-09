import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "cdead");

interface Cand {
  name: string;
  file: string;
  kind: string;
  exported: boolean;
  tier: string;
}

async function candidates(): Promise<Cand[]> {
  const index = await buildIndex(fixture);
  return new QueryEngine(index).deadCodeReport().candidates.map((c) => ({
    name: c.symbol.name,
    file: c.symbol.file,
    kind: c.symbol.kind,
    exported: c.symbol.exported,
    tier: c.tier,
  }));
}

/** A candidate defined in a.c with the given name, if any. */
const inAC = (cands: Cand[], name: string): Cand | undefined =>
  cands.find((c) => c.name === name && c.file.endsWith("a.c"));

describe("C dead-code", () => {
  it("flags an unused static function as HIGH (internal linkage)", async () => {
    const cands = await candidates();
    const c = inAC(cands, "static_unused");
    expect(c).toBeDefined();
    expect(c!.kind).toBe("function");
    expect(c!.exported).toBe(false); // static => internal
    expect(c!.tier).toBe("high");
  });

  it("flags an unused non-static function as LOW (externally linkable)", async () => {
    const cands = await candidates();
    const c = inAC(cands, "orphan_func");
    expect(c).toBeDefined();
    expect(c!.exported).toBe(true); // non-static => exported
    expect(c!.tier).toBe("low");
  });

  it("never flags live code (no false positives)", async () => {
    const cands = await candidates();
    // `int main(...)` is a runtime entry point — a live root, never flagged.
    expect(cands.some((c) => c.name === "main")).toBe(false);
    // used_func: defined in a.c, called from main.c via #include -> alive.
    expect(inAC(cands, "used_func")).toBeUndefined();
    // static_used: a static function used within its own file -> alive.
    expect(inAC(cands, "static_used")).toBeUndefined();
  });
});
