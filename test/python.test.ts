import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "../src/indexer/indexer";
import { QueryEngine } from "../src/query/engine";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "pysample");

describe("python indexer", () => {
  it("extracts functions, classes, methods and module constants", async () => {
    const index = await buildIndex(fixture);
    const names = index.symbols.map((s) => s.name).sort();
    expect(names).toContain("create_user");
    expect(names).toContain("User");
    expect(names).toContain("User.__init__");
    expect(names).toContain("User.rename");
    expect(names).toContain("MAX_USERS");
  });

  it("captures compact Python signatures", async () => {
    const index = await buildIndex(fixture);
    const create = index.symbols.find((s) => s.name === "create_user")!;
    expect(create.signature).toBe("def create_user(name)");
    expect(create.exported).toBe(true);
    const rename = index.symbols.find((s) => s.name === "User.rename")!;
    expect(rename.kind).toBe("method");
  });

  it("classifies ALL_CAPS module names as const", async () => {
    const index = await buildIndex(fixture);
    const max = index.symbols.find((s) => s.name === "MAX_USERS")!;
    expect(max.kind).toBe("const");
  });

  it("resolves cross-file references by name", async () => {
    const index = await buildIndex(fixture);
    const user = index.symbols.find((s) => s.name === "User")!;
    const refs = index.references[user.id];
    // `User` is imported and constructed in service.py.
    expect(refs.some((r) => r.file.endsWith("service.py"))).toBe(true);
  });

  it("leaves genuinely unused symbols with zero references", async () => {
    const index = await buildIndex(fixture);
    const helper = index.symbols.find((s) => s.name === "_unused_helper")!;
    expect(index.references[helper.id]).toHaveLength(0);
  });

  it("builds an import graph across Python files", async () => {
    const index = await buildIndex(fixture);
    const engine = new QueryEngine(index);
    const deps = engine.fileDependencies("service.py");
    expect(deps.imports).toContain("models.py");
    const back = engine.fileDependencies("models.py");
    expect(back.importedBy).toContain("service.py");
  });

  it("treats non-underscore names as public exports", async () => {
    const index = await buildIndex(fixture);
    const priv = index.symbols.find((s) => s.name === "_unused_helper")!;
    expect(priv.exported).toBe(false);
  });
});
