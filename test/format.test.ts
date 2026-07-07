import { describe, it, expect } from "vitest";
import { formatWhoUses } from "../src/format";
import type { WhoUsesResult } from "../src/query/engine";
import type { SymbolInfo } from "../src/types";

const symbol: SymbolInfo = {
  id: "a.ts#foo#1",
  name: "foo",
  kind: "const",
  file: "a.ts",
  line: 1,
  signature: "const foo",
  exported: true,
};

describe("formatWhoUses", () => {
  it("lists every call site inline when there aren't too many", () => {
    const result: WhoUsesResult = {
      symbol,
      references: [
        { file: "b.ts", line: 1 },
        { file: "c.ts", line: 2 },
      ],
    };
    const out = formatWhoUses([result]);
    expect(out).toContain("b.ts:1");
    expect(out).toContain("c.ts:2");
    expect(out).not.toContain("busiest first");
  });

  it("groups by file instead of listing thousands of call sites", () => {
    const references = Array.from({ length: 500 }, (_, i) => ({
      file: `file-${i % 20}.ts`,
      line: i,
    }));
    const result: WhoUsesResult = { symbol, references };
    const out = formatWhoUses([result]);
    expect(out).toContain("500 use(s)");
    expect(out).toContain("PARTIAL SUMMARY");
    expect(out).toContain("used in 20 file(s)");
    expect(out).toContain("full:true");
    // Should not dump all 500 individual file:line entries.
    expect(out.split("\n").length).toBeLessThan(30);
  });

  it("lists every call site when full:true, even for heavily-used symbols", () => {
    const references = Array.from({ length: 500 }, (_, i) => ({
      file: `file-${i % 20}.ts`,
      line: i,
    }));
    const result: WhoUsesResult = { symbol, references };
    const out = formatWhoUses([result], { full: true });
    expect(out).not.toContain("PARTIAL SUMMARY");
    expect(out).toContain("file-0.ts:0");
    expect(out).toContain("file-19.ts:499");
    expect(out.split("\n").length).toBeGreaterThan(500);
  });
});
