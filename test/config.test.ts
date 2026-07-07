import { describe, it, expect } from "vitest";
import { isTestFile } from "../src/config";

describe("isTestFile", () => {
  it("matches test/spec files by suffix", () => {
    expect(isTestFile("src/query/engine.test.ts")).toBe(true);
    expect(isTestFile("src/foo.spec.tsx")).toBe(true);
    expect(isTestFile("src/foo.test.mjs")).toBe(true);
  });

  it("matches files under test, fixture, mock and snapshot dirs", () => {
    expect(isTestFile("test/fixtures/sample/math.ts")).toBe(true);
    expect(isTestFile("test/fixtures/shorthand/registry.ts")).toBe(true);
    expect(isTestFile("src/__tests__/util.ts")).toBe(true);
    expect(isTestFile("src/__mocks__/fs.ts")).toBe(true);
    expect(isTestFile("tests/helpers.ts")).toBe(true);
    expect(isTestFile("e2e/login.ts")).toBe(true);
  });

  it("normalizes Windows separators", () => {
    expect(isTestFile("test\\fixtures\\sample\\math.ts")).toBe(true);
  });

  it("does not flag ordinary source files", () => {
    expect(isTestFile("src/query/engine.ts")).toBe(false);
    expect(isTestFile("src/config.ts")).toBe(false);
    expect(isTestFile("src/latest/thing.ts")).toBe(false);
  });
});
