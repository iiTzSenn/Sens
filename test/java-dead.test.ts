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

    const orphan = byName("Greeter.unusedPrivate");
    expect(orphan).toBeDefined();
    expect(orphan?.symbol.kind).toBe("method");
    expect(orphan?.tier).toBe("low");

    const widget = byName("Widget");
    expect(widget).toBeDefined();
    expect(widget?.symbol.kind).toBe("class");
    expect(widget?.tier).toBe("low");

    expect(names).not.toContain("Main.main");
    expect(names).not.toContain("Main");

    expect(names).not.toContain("Greeter");
    expect(names).not.toContain("Greeter.greet");
    expect(names).not.toContain("Greeter.format");

    expect(names).not.toContain("Calculator");
    expect(names).not.toContain("Calculator.add");

    expect(names).not.toContain("PrintTask.run");

    expect(names).not.toContain("NotificationService");
    expect(names).not.toContain("AppConfig");
    expect(names).not.toContain("AppConfig.greeterBean");
    expect(names).not.toContain("AppConfig.onEvent");

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
