import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";
import type { DeadCodeCandidate } from "../src/query/engine";

const here = path.dirname(fileURLToPath(import.meta.url));

async function candidates(): Promise<DeadCodeCandidate[]> {
  const index = await buildIndex(path.join(here, "fixtures", "csharpdead"));
  // No entry-point files passed: only `entry:true` symbols (Main, controllers,
  // framework actions) seed roots — exactly what we want to exercise.
  return new QueryEngine(index).deadCodeReport().candidates;
}

const byName = (cands: DeadCodeCandidate[], name: string): DeadCodeCandidate | undefined =>
  cands.find((c) => c.symbol.name === name);

describe("C# dead-code accuracy", () => {
  it("surfaces an unused private method as a candidate", async () => {
    const cands = await candidates();
    const secret = byName(cands, "Greeter.UnusedSecret");
    expect(secret).toBeDefined();
    // Methods dispatch poorly under polymorphism, so never above LOW.
    expect(secret?.tier).toBe("low");
  });

  it("reports an unused public class at LOW (could be external API)", async () => {
    const cands = await candidates();
    const orphan = byName(cands, "OrphanWidget");
    expect(orphan).toBeDefined();
    expect(orphan?.tier).toBe("low");
    expect(orphan?.symbol.exported).toBe(true);
  });

  it("NO FALSE POSITIVE: static Main is an entry point", async () => {
    expect(byName(await candidates(), "Program.Main")).toBeUndefined();
  });

  it("NO FALSE POSITIVE: an ASP.NET controller reached only by the framework", async () => {
    const cands = await candidates();
    expect(byName(cands, "UsersController")).toBeUndefined();
    // Its framework-dispatched actions are entry points too.
    expect(byName(cands, "UsersController.GetAll")).toBeUndefined();
    expect(byName(cands, "UsersController.Create")).toBeUndefined();
  });

  it("NO FALSE POSITIVE: an interface method used via the interface stays alive", async () => {
    const cands = await candidates();
    expect(byName(cands, "Circle.Area")).toBeUndefined();
    expect(byName(cands, "IShape.Area")).toBeUndefined();
  });

  it("NO FALSE POSITIVE: a used virtual/override method stays alive", async () => {
    const cands = await candidates();
    expect(byName(cands, "Animal.Speak")).toBeUndefined();
    expect(byName(cands, "Dog.Speak")).toBeUndefined();
  });

  it("NO FALSE POSITIVE: a class instantiated with `new` in another file stays alive", async () => {
    const cands = await candidates();
    expect(byName(cands, "Greeter")).toBeUndefined();
    // A private method that IS called stays out of the list too.
    expect(byName(cands, "Greeter.Format")).toBeUndefined();
  });
});
