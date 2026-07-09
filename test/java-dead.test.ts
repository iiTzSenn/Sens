import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "javadead");

describe("java dead-code accuracy", () => {
  it("classifies candidates and stays false-positive-free", async () => {
    const index = await buildIndex(fixture);
    const cands = new QueryEngine(index).deadCodeReport().candidates;
    const byName = (name: string) => cands.find((c) => c.symbol.name === name);
    const names = cands.map((c) => c.symbol.name);

    // (a) an unused private method surfaces as a candidate.
    const orphan = byName("Greeter.unusedPrivate");
    expect(orphan).toBeDefined();
    expect(orphan?.symbol.kind).toBe("method");
    expect(orphan?.tier).toBe("low");

    // (b) an unused public class is reported at LOW.
    const widget = byName("Widget");
    expect(widget).toBeDefined();
    expect(widget?.symbol.kind).toBe("class");
    expect(widget?.tier).toBe("low");

    // NO FALSE POSITIVES ----------------------------------------------------

    // `main` is a JVM entry point; its class carries the entry too.
    expect(names).not.toContain("Main.main");
    expect(names).not.toContain("Main");

    // same-package cross-file use with no import keeps Greeter alive.
    expect(names).not.toContain("Greeter");
    expect(names).not.toContain("Greeter.greet");
    // the private helper reached from greet() is alive.
    expect(names).not.toContain("Greeter.format");

    // a method invoked via `obj.method()` is alive.
    expect(names).not.toContain("Calculator");
    expect(names).not.toContain("Calculator.add");

    // an @Override method used through the Runnable interface is alive.
    expect(names).not.toContain("PrintTask.run");

    // a class registered only via a framework annotation must not be flagged.
    expect(names).not.toContain("NotificationService");
    expect(names).not.toContain("AppConfig");
    // @Bean / @EventListener methods are reflective callbacks — not dead.
    expect(names).not.toContain("AppConfig.greeterBean");
    expect(names).not.toContain("AppConfig.onEvent");

    // cross-package symbol imported and used stays alive.
    expect(names).not.toContain("StringUtil");
    expect(names).not.toContain("StringUtil.shout");
  });

  it("resolves single-type imports to project files", async () => {
    const index = await buildIndex(fixture);
    const edge = index.imports.find(
      (e) => e.from === "com/app/Main.java" && e.names.includes("StringUtil"),
    );
    expect(edge?.to).toBe("com/app/util/StringUtil.java");
  });
});
