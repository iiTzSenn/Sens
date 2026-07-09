import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";
import type { DeadCodeCandidate } from "../src/query/engine";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "phpdead");

async function candidates(): Promise<DeadCodeCandidate[]> {
  const index = await buildIndex(fixture);
  return new QueryEngine(index).deadCodeReport().candidates;
}

const byName = (cands: DeadCodeCandidate[], name: string): DeadCodeCandidate | undefined =>
  cands.find((c) => c.symbol.name === name);

describe("php dead-code accuracy", () => {
  // (a) An unused top-level function IS flagged. Top-level funcs are `exported`
  // (globally accessible), so the strongest tier they can reach is LOW.
  it("flags an unused top-level function at LOW", async () => {
    const c = byName(await candidates(), "neverCalled");
    expect(c).toBeDefined();
    expect(c?.tier).toBe("low");
    expect(c?.symbol.file).toBe("app.php");
    expect(c?.symbol.kind).toBe("function");
  });

  // Precision win: a genuinely-unused private method still surfaces (as LOW).
  it("flags an unused private method at LOW", async () => {
    const c = byName(await candidates(), "User.unusedSecret");
    expect(c).toBeDefined();
    expect(c?.tier).toBe("low");
    expect(c?.symbol.kind).toBe("method");
  });

  // NO FALSE POSITIVES — every one of these is used somewhere and must not be flagged.
  it("never flags a class instantiated with `new`", async () => {
    expect(byName(await candidates(), "User")).toBeUndefined();
  });

  it("never flags a class used via `extends` / `implements`", async () => {
    const cands = await candidates();
    expect(byName(cands, "Person")).toBeUndefined(); // extended by User
    expect(byName(cands, "Named")).toBeUndefined(); // implemented by User
  });

  it("never flags a method called via `$obj->method()`", async () => {
    expect(byName(await candidates(), "User.getName")).toBeUndefined();
  });

  it("never flags a private method called via `$this->method()`", async () => {
    expect(byName(await candidates(), "User.normalize")).toBeUndefined();
  });

  it("never flags a static method called via `Class::method()`", async () => {
    const cands = await candidates();
    expect(byName(cands, "Registry")).toBeUndefined(); // class referenced
    expect(byName(cands, "Registry.register")).toBeUndefined(); // static call
    expect(byName(cands, "Registry.log")).toBeUndefined(); // self::log()
  });

  it("never flags a used top-level function", async () => {
    expect(byName(await candidates(), "formatName")).toBeUndefined();
  });
});
