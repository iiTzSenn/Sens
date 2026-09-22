import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "pythondead");

describe("python dead-code accuracy", () => {
  it("flags a private unused helper as HIGH and never flags live code", async () => {
    const index = await buildIndex(fixture);
    const cands = new QueryEngine(index).deadCodeReport().candidates;
    const byName = (name: string) => cands.find((c) => c.symbol.name === name);

    const helper = byName("_helper");
    expect(helper).toBeDefined();
    expect(helper?.symbol.file).toBe("util.py");
    expect(helper?.tier).toBe("high");

    expect(byName("ping")).toBeUndefined();
    expect(byName("health")).toBeUndefined();
    expect(byName("shared")).toBeUndefined();
    expect(byName("main")).toBeUndefined();
  });

  it("marks decorated route handlers as framework entry points", async () => {
    const index = await buildIndex(fixture);
    const entryNames = index.symbols.filter((s) => s.entry).map((s) => s.name).sort();
    expect(entryNames).toEqual(["health", "ping"]);
  });

  it("still flags an unused @staticmethod (decorators are not a blanket exemption)", async () => {
    const index = await buildIndex(fixture);
    const cands = new QueryEngine(index).deadCodeReport().candidates;
    const staticm = cands.find((c) => c.symbol.name === "Service.unused_static");
    expect(staticm).toBeDefined();
    expect(staticm?.symbol.kind).toBe("method");
    const sym = index.symbols.find((s) => s.name === "Service.unused_static")!;
    expect(sym.entry).toBeUndefined();
  });
});
