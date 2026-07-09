import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";
import type { DeadCodeCandidate } from "../src/query/engine";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "kotlindead");

async function candidates(): Promise<DeadCodeCandidate[]> {
  const index = await buildIndex(fixture);
  return new QueryEngine(index).deadCodeReport().candidates;
}

const byName = (cands: DeadCodeCandidate[], name: string): DeadCodeCandidate | undefined =>
  cands.find((c) => c.symbol.name === name);

const byNameFile = (
  cands: DeadCodeCandidate[],
  name: string,
  file: string,
): DeadCodeCandidate | undefined =>
  cands.find((c) => c.symbol.name === name && c.symbol.file === file);

describe("kotlin dead-code", () => {
  it("(a) flags a private unused fun as HIGH", async () => {
    const cands = await candidates();
    const c = byName(cands, "secretHelper");
    expect(c).toBeDefined();
    expect(c?.symbol.exported).toBe(false);
    expect(c?.tier).toBe("high");
  });

  it("(b) surfaces a public unused fun at LOW", async () => {
    const cands = await candidates();
    const c = byName(cands, "publicUnused");
    expect(c).toBeDefined();
    expect(c?.symbol.exported).toBe(true);
    expect(c?.tier).toBe("low");
  });

  it("(c) never flags live code: main entry, a constructed class, cross-file call", async () => {
    const cands = await candidates();
    // `fun main` is a runtime entry point.
    expect(byName(cands, "main")).toBeUndefined();
    // `User` is alive via `User("bob")` constructor call.
    expect(byName(cands, "User")).toBeUndefined();
    // `greet` is called cross-file in the same package with no import.
    expect(byName(cands, "greet")).toBeUndefined();
  });

  it("marks a framework-annotated (@Composable) fun as an entry, not dead", async () => {
    const cands = await candidates();
    expect(byName(cands, "Greeting")).toBeUndefined();
  });

  it("scope proof (a): a same-package cross-file use with no import stays alive", async () => {
    const cands = await candidates();
    // Covered by `greet` above; assert explicitly for the used `compute` twin.
    expect(byNameFile(cands, "compute", "com/app/Greet.kt")).toBeUndefined();
  });

  it("scope proof (b): a qualified Obj.member is not starved by a same-named local", async () => {
    const cands = await candidates();
    // `Store.save()` is called qualified; a top-level `save` also exists in the
    // caller's package. The real member must stay alive (never a false positive).
    expect(byName(cands, "Store.save")).toBeUndefined();
    expect(byName(cands, "Store")).toBeUndefined();
  });

  it("scope proof (c): only the unused twin across two packages is flagged", async () => {
    const cands = await candidates();
    // com.other.compute is unused -> flagged HIGH.
    const dead = byNameFile(cands, "compute", "com/other/Other.kt");
    expect(dead?.tier).toBe("high");
    // com.app.compute is used -> not flagged.
    expect(byNameFile(cands, "compute", "com/app/Greet.kt")).toBeUndefined();
  });
});
