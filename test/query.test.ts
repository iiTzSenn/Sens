import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "sample");

async function engine(entryPoints: string[] = []): Promise<QueryEngine> {
  const index = await buildIndex(fixture);
  return new QueryEngine(index, new Set(entryPoints));
}

describe("query engine", () => {
  it("finds a symbol by name", async () => {
    const e = await engine();
    const res = e.findSymbol("add");
    expect(res).toHaveLength(1);
    expect(res[0].file).toContain("math.ts");
  });

  it("lists who uses a symbol", async () => {
    const e = await engine();
    const [res] = e.whoUses("add");
    expect(res.references.length).toBeGreaterThan(0);
    expect(res.references.some((r) => r.file.endsWith("app.ts"))).toBe(true);
  });

  it("already_exists matches by keyword", async () => {
    const e = await engine();
    const res = e.alreadyExists("subtract");
    expect(res.some((s) => s.name === "subtract")).toBe(true);
  });

  it("outlines a file", async () => {
    const e = await engine();
    const outline = e.fileOutline("math.ts").map((s) => s.name);
    expect(outline).toContain("add");
    expect(outline).toContain("PI");
  });

  it("detects dead code but not used symbols", async () => {
    const e = await engine();
    const dead = e.deadCode().map((s) => s.name);
    expect(dead).toContain("subtract");
    expect(dead).toContain("unusedHelper");
    expect(dead).not.toContain("add");
    expect(dead).not.toContain("main");
    expect(dead).not.toContain("PI");
  });

  it("ranks candidates by confidence tier", async () => {
    const e = await engine();
    const byName = new Map(e.deadCodeReport().candidates.map((c) => [c.symbol.name, c]));
    // internal + unreferenced -> highest confidence.
    expect(byName.get("unusedHelper")?.tier).toBe("high");
    // exported -> could be public API, lowest confidence.
    expect(byName.get("subtract")?.tier).toBe("low");
  });

  it("treats exports in entry-point files as used", async () => {
    const e = await engine(["math.ts"]);
    const dead = e.deadCode().map((s) => s.name);
    expect(dead).not.toContain("subtract"); // exported from an entry point
    expect(dead).toContain("unusedHelper"); // not exported -> still a candidate
  });

  it("explains a symbol's callers and callees", async () => {
    const e = await engine();
    const [addN] = e.explain("add");
    expect(addN.callers.some((s) => s.name === "main")).toBe(true);
    expect(addN.callees).toHaveLength(0);
    const [mainN] = e.explain("main");
    expect(mainN.callees.map((s) => s.name).sort()).toEqual(["PI", "add"]);
  });

  it("finds the shortest path between two symbols", async () => {
    const e = await engine();
    const p = e.path("main", "add");
    expect(p?.map((s) => s.name)).toEqual(["main", "add"]);
  });

  it("returns null when two symbols are not connected", async () => {
    const e = await engine();
    expect(e.path("main", "subtract")).toBeNull();
  });

  it("resolves a file's import-graph neighbors", async () => {
    const e = await engine();
    const deps = e.fileDependencies("app.ts");
    expect(deps.imports.some((f) => f.endsWith("math.ts"))).toBe(true);
    const reverse = e.fileDependencies("math.ts");
    expect(reverse.importedBy.some((f) => f.endsWith("app.ts"))).toBe(true);
  });
});

describe("dead islands (reachability)", () => {
  async function islandEngine(): Promise<QueryEngine> {
    const index = await buildIndex(path.join(here, "fixtures", "island"));
    return new QueryEngine(index);
  }

  it("flags a mutually-referencing cluster a zero-ref filter would miss", async () => {
    const e = await islandEngine();
    const ranked = new Map(e.deadCodeReport().candidates.map((c) => [c.symbol.name, c]));
    // islandA/islandB each have a reference (from the other), so they are NOT
    // zero-ref — yet the whole cluster is unreachable.
    expect(ranked.get("islandA")?.tier).toBe("medium");
    expect(ranked.get("islandB")?.tier).toBe("medium");
    // deadExport is an unused export -> low confidence (might be public API).
    expect(ranked.get("deadExport")?.tier).toBe("low");
  });

  it("keeps reachable symbols — and an export's private helper — out of the list", async () => {
    const e = await islandEngine();
    const dead = e.deadCode().map((s) => s.name);
    expect(dead).not.toContain("entry"); // root: called at module scope
    expect(dead).not.toContain("liveHelper"); // reached from entry
    // reached only through deadExport, which might be called externally -> spared.
    expect(dead).not.toContain("privateOfDeadExport");
  });
});
