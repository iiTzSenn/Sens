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

    // (a) unused unexported func -> HIGH candidate.
    const unused = byName("unusedHelper");
    expect(unused).toHaveLength(1);
    expect(unused[0].tier).toBe("high");
    expect(unused[0].symbol.exported).toBe(false);

    // (b) unused Exported func -> LOW candidate.
    const exp = byName("ExportedUnused");
    expect(exp).toHaveLength(1);
    expect(exp[0].tier).toBe("low");
    expect(exp[0].symbol.exported).toBe(true);

    // (c) NO FALSE POSITIVES — none of these may be flagged:
    //   func main (package main) is a runtime entry point.
    expect(flagged("main")).toBe(false);
    //   func init is a runtime entry point.
    expect(flagged("init")).toBe(false);
    //   same-package cross-file call with no import.
    expect(flagged("setup")).toBe(false);
    expect(flagged("usedHelper")).toBe(false);
    //   a method used on a value.
    expect(flagged("Thing.Greet")).toBe(false);
    expect(flagged("Greet")).toBe(false);
    //   qualified pkg1.Run() must count the remote even though a local `Run`
    //   with the same name exists in package main.
    expect(flagged("Run", "pkg1/api.go")).toBe(false);
    //   live same-package helper chain in pkg1.
    expect(flagged("Shared", "pkg1/api.go")).toBe(false);
    expect(flagged("helper1")).toBe(false);

    // Same-named func in two packages, only one used -> only the dead one flagged.
    const deadShared = byName("Shared", "pkg2/api.go");
    expect(deadShared).toHaveLength(1);
    expect(deadShared[0].tier).toBe("low");
  });
});
