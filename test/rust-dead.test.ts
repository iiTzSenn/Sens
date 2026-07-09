import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";

const here = path.dirname(fileURLToPath(import.meta.url));

async function candidates() {
  const index = await buildIndex(path.join(here, "fixtures", "rustdead"));
  return new QueryEngine(index).deadCodeReport().candidates;
}

describe("rust dead-code", () => {
  it("flags a private unused fn as HIGH", async () => {
    const cands = await candidates();
    const c = cands.find(
      (x) => x.symbol.name === "private_unused" && x.symbol.file === "main.rs",
    );
    expect(c?.tier).toBe("high");
  });

  it("flags a pub unused fn as LOW (possible public API)", async () => {
    const cands = await candidates();
    const c = cands.find(
      (x) => x.symbol.name === "public_unused" && x.symbol.file === "main.rs",
    );
    expect(c?.tier).toBe("low");
  });

  it("never flags entry points (main, #[no_mangle] extern, #[test])", async () => {
    const names = (await candidates()).map((c) => c.symbol.name);
    expect(names).not.toContain("main");
    expect(names).not.toContain("ffi_entry");
    expect(names).not.toContain("it_works");
  });

  it("keeps cross-module functions used via qualified path or `use` alive", async () => {
    const cands = await candidates();
    const live = (name: string) =>
      expect(cands.find((c) => c.symbol.name === name)).toBeUndefined();
    live("run"); // alpha::run / beta::run — called via `alpha::run()` etc.
    live("via_use"); // reached via `use crate::alpha::via_use` + call in worker
    live("greet"); // widgets::greet(&w)
  });

  it("keeps an instance method and a trait method alive", async () => {
    const cands = await candidates();
    // Widget::new and Widget::value are called on an instance.
    expect(cands.find((c) => c.symbol.name === "Widget.new")).toBeUndefined();
    expect(cands.find((c) => c.symbol.name === "Widget.value")).toBeUndefined();
    // Speak::speak reached only via the trait bound in greet.
    expect(cands.find((c) => c.symbol.name === "Widget.speak")).toBeUndefined();
  });

  it("reports a genuinely unused method at LOW, not higher", async () => {
    const cands = await candidates();
    const secret = cands.find((c) => c.symbol.name === "Widget.secret");
    expect(secret?.tier).toBe("low");
  });

  it("import-scoping isolates same-named twins across modules", async () => {
    const cands = await candidates();
    const helper = (file: string) =>
      cands.find((c) => c.symbol.name === "helper" && c.symbol.file === file);
    // alpha::helper is used by alpha::run -> alive.
    expect(helper("alpha.rs")).toBeUndefined();
    // beta::helper shares the name but nobody uses it -> caught as HIGH.
    expect(helper("beta.rs")?.tier).toBe("high");
  });
});
