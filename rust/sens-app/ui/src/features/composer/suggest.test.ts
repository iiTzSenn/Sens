import { describe, expect, it } from "vitest";
import type { Entry, Slash } from "../../ipc/types";
import { applied, commandOf, inFolder, mentionOf, rankFiles, rankSlashes, triggerAt, SUGGEST_CAP } from "./suggest";

const slash = (name: string): Slash => ({ name, description: "", hint: "" });
const file = (path: string, dir = false): Entry => ({ name: path.split("/").pop()!, path, dir, ignored: false });

describe("what the caret is on", () => {
  it("a command only at the very start of the message", () => {
    expect(triggerAt("/com", 4)).toEqual({ kind: "command", start: 0, end: 4, query: "com" });
    expect(triggerAt("/", 1)).toEqual({ kind: "command", start: 0, end: 1, query: "" });
    expect(triggerAt("hola /com", 9)).toBeNull();
    expect(triggerAt("/compact ahora", 14)).toBeNull();
  });

  it("a file after an @ that starts a word, up to the end of that word", () => {
    expect(triggerAt("mira @src/Ap", 12)).toEqual({ kind: "file", start: 5, end: 12, query: "src/Ap" });
    expect(triggerAt("mira @src/App.tsx y", 9)).toEqual({ kind: "file", start: 5, end: 17, query: "src" });
    expect(triggerAt("@", 1)).toEqual({ kind: "file", start: 0, end: 1, query: "" });
    expect(triggerAt('ver @"mis doc', 13)).toEqual({ kind: "file", start: 4, end: 13, query: "mis doc" });
  });

  it("nothing in an address or once the word is closed", () => {
    expect(triggerAt("ada@example.com", 15)).toBeNull();
    expect(triggerAt("mira @src/App.tsx ", 18)).toBeNull();
    expect(triggerAt("", 0)).toBeNull();
  });
});

describe("ranking", () => {
  it("puts the names that start with what was typed first, then the shorter ones", () => {
    const offered = ["frontend-design", "compact", "context", "cowork-plugin-management:create-cowork-plugin", "recompact"].map(slash);
    expect(rankSlashes(offered, "co").map((one) => one.name)).toEqual(["compact", "context", "cowork-plugin-management:create-cowork-plugin", "recompact"]);
    expect(rankSlashes(offered, "create").map((one) => one.name)).toEqual(["cowork-plugin-management:create-cowork-plugin"]);
    expect(rankSlashes(offered, "zz")).toEqual([]);
  });

  it("matches files by name before path, leaves folders out and keeps to the cap", () => {
    const tree = [file("docs/app-notes.md"), file("src"), file("src/App.tsx"), file("src/features/apple/App.test.tsx"), file("README.md", false)];
    expect(rankFiles(tree, "app").map((one) => one.path)).toEqual(["src/App.tsx", "docs/app-notes.md", "src/features/apple/App.test.tsx"]);
    expect(rankFiles(tree.concat(file("src", true)), "src").every((one) => !one.dir)).toBe(true);
    expect(rankFiles(Array.from({ length: 20 }, (_, at) => file(`f${at}.ts`)), "f")).toHaveLength(SUGGEST_CAP);
  });
});

describe("what a pick writes", () => {
  it("a mention, quoted when the path has spaces, and a command", () => {
    expect(mentionOf("src/App.tsx")).toBe("@src/App.tsx ");
    expect(mentionOf("mis docs/plan.md")).toBe('@"mis docs/plan.md" ');
    expect(commandOf("compact")).toBe("/compact ");
    expect(inFolder("C:/demo/", "docs/a.md")).toBe("C:/demo/docs/a.md");
  });

  it("replaces the word it came from and leaves the caret after it, without doubling a space", () => {
    const trigger = triggerAt("mira @sr y ya", 8)!;
    expect(applied("mira @sr y ya", trigger, mentionOf("src/App.tsx"))).toEqual({ text: "mira @src/App.tsx y ya", caret: 18 });
    const command = triggerAt("/co", 3)!;
    expect(applied("/co", command, commandOf("compact"))).toEqual({ text: "/compact ", caret: 9 });
  });
});
