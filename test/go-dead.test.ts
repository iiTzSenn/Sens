import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("go dead-code accuracy", () => {
  it("flags dead funcs but never live/entry code (zero false positives)", async () => {
    const index = await buildIndex(path.join(here, "fixtures", "godead"));
    const cands = new QueryEngine(index).deadCodeReport().candidates;

    const byName = (name: string, file?: string) =>
      cands.filter(
        (c) => c.symbol.name === name && (!file || c.symbol.file === file),
      );
    const flagged = (name: string, file?: string) => byName(name, file).length > 0;

    const unused = byName("unusedHelper");
    expect(unused).toHaveLength(1);
    expect(unused[0].tier).toBe("high");
    expect(unused[0].symbol.exported).toBe(false);

    const exp = byName("ExportedUnused");
    expect(exp).toHaveLength(1);
    expect(exp[0].tier).toBe("low");
    expect(exp[0].symbol.exported).toBe(true);

    expect(flagged("main")).toBe(false);
    expect(flagged("init")).toBe(false);
    expect(flagged("setup")).toBe(false);
    expect(flagged("usedHelper")).toBe(false);
    expect(flagged("Thing.Greet")).toBe(false);
    expect(flagged("Greet")).toBe(false);
    expect(flagged("Run", "pkg1/api.go")).toBe(false);
    expect(flagged("Shared", "pkg1/api.go")).toBe(false);
    expect(flagged("helper1")).toBe(false);

    const deadShared = byName("Shared", "pkg2/api.go");
    expect(deadShared).toHaveLength(1);
    expect(deadShared[0].tier).toBe("low");
  });
});
