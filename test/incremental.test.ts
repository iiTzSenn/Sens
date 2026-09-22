import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureIndex, refreshIndex } from "../src/core";
import { loadIndex } from "../src/store/store";
import { updateIndex } from "../src/indexer/incremental";
import type { ProjectIndex } from "../src/types";

let root: string;

const write = (file: string, body: string): void => {
  writeFileSync(path.join(root, file), body);
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "sens-incr-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  write(
    "src/rows.ts",
    [
      "export function parseRow(raw: string): string {",
      "  return raw.trim();",
      "}",
      "export function widen(raw: string): string {",
      "  return raw + raw;",
      "}",
      "",
    ].join("\n"),
  );
  write(
    "src/boot.ts",
    [
      'import { parseRow, widen } from "./rows.js";',
      "export function boot(raw: string): string {",
      "  return widen(parseRow(raw));",
      "}",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function normalize(index: ProjectIndex): unknown {
  return {
    files: [...index.files].sort((a, b) => a.path.localeCompare(b.path)),
    symbols: [...index.symbols].sort((a, b) => a.id.localeCompare(b.id)),
    imports: [...index.imports]
      .map((edge) => `${edge.from}->${edge.to}:${[...edge.names].sort().join(",")}`)
      .sort(),
    references: Object.entries(index.references)
      .map(
        ([id, refs]) =>
          `${id}|${refs
            .map((ref) => `${ref.file}:${ref.line}:${ref.from ?? ""}`)
            .sort()
            .join(",")}`,
      )
      .sort(),
  };
}

async function updatedAndRebuilt(
  touched: string[],
): Promise<{ incremental: ProjectIndex; full: ProjectIndex; tookFastPath: boolean }> {
  const updated = await refreshIndex(root, touched);
  const rebuilt = await ensureIndex(root, { force: true });
  return {
    incremental: updated.index,
    full: rebuilt.index,
    tookFastPath: updated.incremental,
  };
}

describe("incremental index", { timeout: 30000 }, () => {
  it("matches a full rebuild when a body changes", async () => {
    await ensureIndex(root);
    write(
      "src/rows.ts",
      [
        "export function parseRow(raw: string): string {",
        "  return raw.trim().toLowerCase();",
        "}",
        "export function widen(raw: string): string {",
        "  return raw + raw;",
        "}",
        "",
      ].join("\n"),
    );

    const { incremental, full, tookFastPath } = await updatedAndRebuilt(["src/rows.ts"]);

    expect(tookFastPath).toBe(true);
    expect(normalize(incremental)).toEqual(normalize(full));
  });

  it("matches a full rebuild when new code pushes symbols down", async () => {
    await ensureIndex(root);
    write(
      "src/rows.ts",
      [
        "function shout(raw: string): string {",
        "  return raw.toUpperCase();",
        "}",
        "export function parseRow(raw: string): string {",
        "  return shout(raw.trim());",
        "}",
        "export function widen(raw: string): string {",
        "  return raw + raw;",
        "}",
        "",
      ].join("\n"),
    );

    const { incremental, full, tookFastPath } = await updatedAndRebuilt(["src/rows.ts"]);

    expect(tookFastPath).toBe(true);
    expect(normalize(incremental)).toEqual(normalize(full));

    const moved = incremental.symbols.find((s) => s.name === "parseRow");
    expect(moved?.line).toBe(4);
    expect(incremental.references[moved!.id]?.some((r) => r.file === "src/boot.ts")).toBe(true);
  });

  it("matches a full rebuild when a symbol is renamed", async () => {
    await ensureIndex(root);
    write(
      "src/rows.ts",
      [
        "export function parseLine(raw: string): string {",
        "  return raw.trim();",
        "}",
        "export function widen(raw: string): string {",
        "  return raw + raw;",
        "}",
        "",
      ].join("\n"),
    );

    const { incremental, full, tookFastPath } = await updatedAndRebuilt(["src/rows.ts"]);

    expect(tookFastPath).toBe(true);
    expect(normalize(incremental)).toEqual(normalize(full));
    expect(incremental.symbols.some((s) => s.name === "parseRow")).toBe(false);
  });

  it("matches a full rebuild when a file is deleted", async () => {
    write("src/extra.ts", 'import { widen } from "./rows.js";\nexport const extra = widen("x");\n');
    await ensureIndex(root);
    unlinkSync(path.join(root, "src/extra.ts"));

    const { incremental, full, tookFastPath } = await updatedAndRebuilt(["src/extra.ts"]);

    expect(tookFastPath).toBe(true);
    expect(normalize(incremental)).toEqual(normalize(full));
    expect(incremental.files.some((f) => f.path === "src/extra.ts")).toBe(false);
  });

  it("takes in a file that appeared, and the import that reaches it", async () => {
    await ensureIndex(root);
    write("src/extra.ts", "export function extra(raw: string): string {\n  return raw;\n}\n");
    write(
      "src/boot.ts",
      [
        'import { parseRow, widen } from "./rows.js";',
        'import { extra } from "./extra.js";',
        "export function boot(raw: string): string {",
        "  return extra(widen(parseRow(raw)));",
        "}",
        "",
      ].join("\n"),
    );

    const { incremental, full, tookFastPath } = await updatedAndRebuilt([
      "src/extra.ts",
      "src/boot.ts",
    ]);

    expect(tookFastPath).toBe(true);
    expect(normalize(incremental)).toEqual(normalize(full));

    const born = incremental.symbols.find((s) => s.name === "extra");
    expect(born).toBeDefined();
    expect(incremental.references[born!.id]?.some((r) => r.file === "src/boot.ts")).toBe(true);
  });

  it("rebuilds in full when a file appeared that nobody mentioned", async () => {
    await ensureIndex(root);
    write("src/extra.ts", "export function extra(): number {\n  return 1;\n}\n");
    write("src/other.ts", "export function other(): number {\n  return 2;\n}\n");

    const { incremental, tookFastPath } = await updatedAndRebuilt(["src/extra.ts"]);

    expect(tookFastPath).toBe(false);
    expect(incremental.files.some((f) => f.path === "src/other.ts")).toBe(true);
  });

  it("leaves the index alone when what appeared is not code it indexes", async () => {
    await ensureIndex(root);
    const before = (await ensureIndex(root)).index;
    write("notas.md", "# notas\n");

    const { incremental, tookFastPath } = await updatedAndRebuilt(["notas.md"]);

    expect(tookFastPath).toBe(true);
    expect(incremental.symbols.length).toBe(before.symbols.length);
    expect(incremental.files.some((f) => f.path === "notas.md")).toBe(false);
  });

  it("rebuilds in full when the touched file is not TypeScript", async () => {
    write("src/tool.py", "def tool():\n    return 1\n");
    await ensureIndex(root);
    write("src/tool.py", "def tool():\n    return 2\n");

    const { tookFastPath } = await updatedAndRebuilt(["src/tool.py"]);

    expect(tookFastPath).toBe(false);
  });
  it("keeps a string-literal reference to a file the change never imports", async () => {
    write("src/lonely.ts", "export function lonelyThing(): number {\n  return 1;\n}\n");
    await ensureIndex(root);
    write(
      "src/boot.ts",
      [
        'import { parseRow, widen } from "./rows.js";',
        'const which = "lonelyThing";',
        "export function boot(raw: string): string {",
        "  return which + widen(parseRow(raw));",
        "}",
        "",
      ].join("\n"),
    );

    const { incremental, full, tookFastPath } = await updatedAndRebuilt(["src/boot.ts"]);

    expect(tookFastPath).toBe(true);
    expect(normalize(incremental)).toEqual(normalize(full));

    const lonely = incremental.symbols.find((s) => s.name === "lonelyThing");
    expect(incremental.references[lonely!.id]?.some((r) => r.file === "src/boot.ts")).toBe(true);
  });

  it("rebuilds in full when a new export is named in a file it did not touch", async () => {
    write(
      "src/boot.ts",
      [
        'import { parseRow, widen } from "./rows.js";',
        'export const wanted = "shout";',
        "export function boot(raw: string): string {",
        "  return widen(parseRow(raw));",
        "}",
        "",
      ].join("\n"),
    );
    await ensureIndex(root);
    write(
      "src/rows.ts",
      [
        "export function shout(raw: string): string {",
        "  return raw.toUpperCase();",
        "}",
        "export function parseRow(raw: string): string {",
        "  return raw.trim();",
        "}",
        "export function widen(raw: string): string {",
        "  return raw + raw;",
        "}",
        "",
      ].join("\n"),
    );

    const { incremental, tookFastPath } = await updatedAndRebuilt(["src/rows.ts"]);

    expect(tookFastPath).toBe(false);

    const shout = incremental.symbols.find((s) => s.name === "shout");
    expect(incremental.references[shout!.id]?.some((r) => r.file === "src/boot.ts")).toBe(true);
  });
  it("matches a full rebuild twice over, on a warm project", async () => {
    await ensureIndex(root);
    write(
      "src/rows.ts",
      [
        "export function parseRow(raw: string): string {",
        "  return raw.trim().toLowerCase();",
        "}",
        "export function widen(raw: string): string {",
        "  return raw + raw;",
        "}",
        "",
      ].join("\n"),
    );

    const first = await updateIndex(root, loadIndex(root) as ProjectIndex, ["src/rows.ts"], {
      keepWarm: true,
    });
    expect(first).not.toBeNull();

    write(
      "src/boot.ts",
      [
        'import { parseRow, widen } from "./rows.js";',
        "export function boot(raw: string): string {",
        "  return widen(parseRow(raw)) + widen(raw);",
        "}",
        "",
      ].join("\n"),
    );

    const second = await updateIndex(root, first as ProjectIndex, ["src/boot.ts"], {
      keepWarm: true,
    });
    const full = (await ensureIndex(root, { force: true })).index;

    expect(second).not.toBeNull();
    expect(normalize(second as ProjectIndex)).toEqual(normalize(full));
  });

  it("refuses when a file it was not told about moved", async () => {
    await ensureIndex(root);
    write("src/boot.ts", "export function boot(raw: string): string {\n  return raw;\n}\n");

    const updated = await updateIndex(root, loadIndex(root) as ProjectIndex, ["src/rows.ts"]);

    expect(updated).toBeNull();
  });
  it("forgets a deleted file on the warm path, and still matches a full rebuild", async () => {
    write(
      "src/extra.ts",
      "export function extra(raw: string): string {\n  return raw + raw;\n}\n",
    );
    write(
      "src/boot.ts",
      [
        'import { parseRow, widen } from "./rows.js";',
        'import { extra } from "./extra.js";',
        "export function boot(raw: string): string {",
        "  return extra(widen(parseRow(raw)));",
        "}",
        "",
      ].join("\n"),
    );
    await ensureIndex(root);

    unlinkSync(path.join(root, "src/extra.ts"));
    write(
      "src/boot.ts",
      [
        'import { parseRow, widen } from "./rows.js";',
        "export function boot(raw: string): string {",
        "  return widen(parseRow(raw));",
        "}",
        "",
      ].join("\n"),
    );

    const gone = await updateIndex(
      root,
      loadIndex(root) as ProjectIndex,
      ["src/extra.ts", "src/boot.ts"],
      { keepWarm: true, present: new Set(["src/rows.ts", "src/boot.ts"]) },
    );
    expect(gone).not.toBeNull();
    expect((gone as ProjectIndex).symbols.some((s) => s.name === "extra")).toBe(false);

    write(
      "src/rows.ts",
      [
        "export function parseRow(raw: string): string {",
        "  return raw.trim();",
        "}",
        "export function widen(raw: string): string {",
        "  return raw + raw + raw;",
        "}",
        "",
      ].join("\n"),
    );

    const after = await updateIndex(root, gone as ProjectIndex, ["src/rows.ts"], {
      keepWarm: true,
    });
    const full = (await ensureIndex(root, { force: true })).index;

    expect(after).not.toBeNull();
    expect(normalize(after as ProjectIndex)).toEqual(normalize(full));
  });
});
