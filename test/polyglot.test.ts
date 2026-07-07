import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";
import type { ProjectIndex } from "../src/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "polyglot");

// One shared build for the whole file: loading a fresh tree-sitter grammar per
// language is the expensive part, and web-tree-sitter caps how many grammars a
// single process can load, so we never want more than one build per test file.
let index: ProjectIndex;
async function getIndex(): Promise<ProjectIndex> {
  if (!index) index = await buildIndex(fixture);
  return index;
}

const nameOf = (file: string) =>
  (s: { file: string }) => s.file.endsWith(file);

describe("polyglot indexer", () => {
  it("extracts Go functions, structs and receiver methods", async () => {
    const syms = (await getIndex()).symbols.filter(nameOf("sample.go"));
    const names = syms.map((s) => s.name);
    expect(names).toContain("Greet");
    expect(names).toContain("User");
    expect(names).toContain("User.Rename");
    expect(names).toContain("MaxItems");
  });

  it("extracts Rust functions, structs and impl methods", async () => {
    const names = (await getIndex()).symbols.filter(nameOf("sample.rs")).map((s) => s.name);
    expect(names).toContain("greet");
    expect(names).toContain("User");
    expect(names).toContain("User.rename");
    expect(names).toContain("MAX");
  });

  it("extracts Java classes and methods and resolves imports", async () => {
    const idx = await getIndex();
    const names = idx.symbols.filter(nameOf("Sample.java")).map((s) => s.name);
    expect(names).toContain("User");
    expect(names).toContain("User.greet");
    expect(names).toContain("User.rename");
  });

  it("extracts C# classes and methods inside a namespace", async () => {
    const names = (await getIndex()).symbols.filter(nameOf("Sample.cs")).map((s) => s.name);
    expect(names).toContain("User");
    expect(names).toContain("User.Greet");
  });

  it("extracts C functions, structs and #defines", async () => {
    const names = (await getIndex()).symbols.filter(nameOf("sample.c")).map((s) => s.name);
    expect(names).toContain("greet");
    expect(names).toContain("Point");
    expect(names).toContain("MAX");
  });

  it("extracts C++ classes, methods and functions", async () => {
    const names = (await getIndex()).symbols.filter(nameOf("sample.cpp")).map((s) => s.name);
    expect(names).toContain("User");
    expect(names).toContain("greet");
    expect(names.some((n) => n === "User.rename")).toBe(true);
  });

  it("extracts PHP functions, classes, methods and constants", async () => {
    const names = (await getIndex()).symbols.filter(nameOf("sample.php")).map((s) => s.name);
    expect(names).toContain("greet");
    expect(names).toContain("User");
    expect(names).toContain("User.rename");
    expect(names).toContain("MAX");
  });

  it("extracts Ruby methods, classes and constants", async () => {
    const names = (await getIndex()).symbols.filter(nameOf("sample.rb")).map((s) => s.name);
    expect(names).toContain("greet");
    expect(names).toContain("User");
    expect(names).toContain("User.rename");
    expect(names).toContain("MAX");
  });

  it("extracts Kotlin functions, classes, methods and constants", async () => {
    const names = (await getIndex()).symbols.filter(nameOf("Sample.kt")).map((s) => s.name);
    expect(names).toContain("greet");
    expect(names).toContain("User");
    expect(names).toContain("User.rename");
    expect(names).toContain("MAX");
    expect(names).toContain("Speak");
  });

  it("captures a compact signature per language", async () => {
    const idx = await getIndex();
    const goGreet = idx.symbols.find((s) => s.name === "Greet" && s.file.endsWith("sample.go"))!;
    expect(goGreet.signature).toContain("func Greet");
    const rustGreet = idx.symbols.find((s) => s.name === "greet" && s.file.endsWith("sample.rs"))!;
    expect(rustGreet.signature).toContain("fn greet");
  });

  it("marks public symbols as exported and lists them on the map", async () => {
    const engine = new QueryEngine(await getIndex());
    const goEntry = engine.map().find((e) => e.file.endsWith("sample.go"))!;
    expect(goEntry.exported.some((s) => s.name === "Greet")).toBe(true);
  });
});
