import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  utimesSync,
  statSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureIndex, createEngine } from "../src/core";
import { isFresh, loadIndex } from "../src/store/store";
import { loadMeta, structureUnchanged } from "../src/store/meta";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "sens-fresh-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "a.ts"), "export function a() { return 1; }\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function backdate(p: string, seconds = 10): void {
  const s = statSync(p);
  const when = new Date(s.mtimeMs - seconds * 1000);
  utimesSync(p, when, when);
}

const write = (rel: string, body: string): void => {
  writeFileSync(path.join(root, rel), body);
};

const meta = () => loadMeta(root, loadIndex(root)!.createdAt);

describe("freshness fast path", () => {
  it("takes the fast path immediately after a build", async () => {

    backdate(root);
    await ensureIndex(root);
    const m = meta();
    expect(m).not.toBeNull();
    expect(structureUnchanged(root, m!.watched)).toBe(true);
  });

  it("watches the root, its directories and every .gitignore", async () => {
    write(".gitignore", "ignored/\n");
    mkdirSync(path.join(root, "src", "nested"));
    await ensureIndex(root);
    const paths = meta()!.watched.map((w) => w.path);
    expect(paths).toContain("");
    expect(paths).toContain("src");
    expect(paths).toContain("src/nested");
    expect(paths).toContain(".gitignore");
  });

  it("reports fresh when nothing changed", async () => {
    const { index } = await ensureIndex(root);
    expect(await isFresh(root, index)).toBe(true);
  });

  it("detects an edit to an indexed file", async () => {
    const { index } = await ensureIndex(root);
    backdate(path.join(root, "src", "a.ts"), -10);
    expect(await isFresh(root, index)).toBe(false);
  });

  it("detects a deleted file", async () => {
    const { index } = await ensureIndex(root);
    rmSync(path.join(root, "src", "a.ts"));
    expect(await isFresh(root, index)).toBe(false);
  });

  it("detects a new source file in an existing directory", async () => {
    const { index } = await ensureIndex(root);
    write("src/b.ts", "export function b() { return 2; }\n");
    expect(await isFresh(root, index)).toBe(false);
  });

  it("detects a new source file in a brand-new directory", async () => {

    const { index } = await ensureIndex(root);
    mkdirSync(path.join(root, "src", "deep"));
    write("src/deep/c.ts", "export const c = 3;\n");
    expect(await isFresh(root, index)).toBe(false);
  });

  it("detects a new top-level source file", async () => {
    const { index } = await ensureIndex(root);
    write("top.ts", "export const top = 1;\n");
    expect(await isFresh(root, index)).toBe(false);
  });

  it("stays fresh when a non-indexable file appears", async () => {

    const { index } = await ensureIndex(root);
    write("src/notes.md", "# hola\n");
    expect(await isFresh(root, index)).toBe(true);
  });
  it("stays fresh when a gitignored file appears", async () => {
    write(".gitignore", "build/\n");
    const { index } = await ensureIndex(root);
    mkdirSync(path.join(root, "build"));
    write("build/out.ts", "export const out = 1;\n");
    expect(await isFresh(root, index)).toBe(true);
  });

  it("re-snapshots after a full scan so the fast path works again", async () => {

    const { index } = await ensureIndex(root);
    write("src/notes.md", "# hola\n");
    expect(structureUnchanged(root, meta()!.watched)).toBe(false);
    expect(await isFresh(root, index)).toBe(true);
    expect(structureUnchanged(root, meta()!.watched)).toBe(true);
  });

  it("falls back to a full scan when the metadata is missing", async () => {
    const { index } = await ensureIndex(root);
    rmSync(path.join(root, ".sens", "meta.json"));
    expect(await isFresh(root, index)).toBe(true);

    write("src/b.ts", "export function b() { return 2; }\n");
    expect(await isFresh(root, index)).toBe(false);
  });

  it("discards metadata left over from a previous index", async () => {
    await ensureIndex(root);
    const stale = JSON.parse(readFileSync(path.join(root, ".sens", "meta.json"), "utf8"));
    expect(loadMeta(root, stale.indexCreatedAt + 1)).toBeNull();
  });
});

describe("entry-point cache", () => {
  it("serves entry points from the metadata instead of re-globbing", async () => {
    write("index.ts", "export { a } from './src/a';\n");
    await ensureIndex(root);
    expect(meta()!.entryPoints).toContain("index.ts");
  });

  it("keeps dead-code results identical whether cached or freshly derived", async () => {
    write("index.ts", "export { a } from './src/a';\n");
    write("src/orphan.ts", "export function orphan() { return 0; }\n");

    const first = await createEngine(root, { force: true });
    const cached = first.engine.deadCode().map((s) => s.name);

    rmSync(path.join(root, ".sens", "meta.json"));
    const second = await createEngine(root, { force: true });
    expect(second.engine.deadCode().map((s) => s.name)).toEqual(cached);
    expect(cached).toContain("orphan");
    expect(cached).not.toContain("a");
  });
});
