import { describe, expect, it } from "vitest";
import { diffedFiles, freshFile } from "./diff";

const DIFF = [
  "diff --git a/src/app.js b/src/app.js",
  "index 1111111..2222222 100644",
  "--- a/src/app.js",
  "+++ b/src/app.js",
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " export { a };",
  "@@ -20 +21 @@",
  "-old\r",
  "+new\r",
  "diff --git a/docs/new.md b/docs/new.md",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/docs/new.md",
  "@@ -0,0 +1 @@",
  "+# Nuevo",
  "diff --git a/gone.txt b/gone.txt",
  "deleted file mode 100644",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-bye",
  "diff --git a/old name.txt b/new name.txt",
  "similarity index 100%",
  "rename from old name.txt",
  "rename to new name.txt",
  "diff --git a/logo.png b/logo.png",
  "Binary files a/logo.png and b/logo.png differ",
].join("\n");

describe("git diff", () => {
  const files = diffedFiles(DIFF);

  it("finds every file with its state", () => {
    expect(files.map((file) => [file.path, file.state])).toEqual([
      ["src/app.js", "M"],
      ["docs/new.md", "A"],
      ["gone.txt", "D"],
      ["new name.txt", "R"],
      ["logo.png", "M"],
    ]);
  });

  it("counts lines per file and keeps the hunks, without the CR", () => {
    const [app] = files;
    expect([app.plus, app.minus]).toEqual([3, 2]);
    expect(app.hunks.map((hunk) => [hunk.oldStart, hunk.newStart])).toEqual([
      [1, 1],
      [20, 21],
    ]);
    expect(app.hunks[1].lines).toEqual(["-old", "+new"]);
  });

  it("keeps where a rename came from and marks binaries", () => {
    expect(files[3]).toMatchObject({ from: "old name.txt", hunks: [] });
    expect(files[4].binary).toBe(true);
  });

  it("reads nothing before the first file, and an untracked file as fresh", () => {
    expect(diffedFiles("warning: CRLF\n")).toEqual([]);
    expect(freshFile("a.txt")).toMatchObject({ path: "a.txt", state: "A", fresh: true });
  });
});
