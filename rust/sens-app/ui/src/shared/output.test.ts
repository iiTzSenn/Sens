import { describe, expect, it } from "vitest";
import { cueOf, hunkOf, marksOf, shapeOf, within } from "./output";

describe("what a command printed", () => {
  it("is JSON when all of it parses, a diff when it has files and hunks, else text", () => {
    expect(shapeOf('{"name": "sens", "ok": true}\n')).toBe("json");
    expect(shapeOf("[1, 2]")).toBe("json");
    expect(shapeOf("{ not json }")).toBe("text");
    expect(shapeOf(["diff --git a/x.ts b/x.ts", "--- a/x.ts", "+++ b/x.ts", "@@ -1,2 +1,2 @@", "-a", "+b"].join("\n"))).toBe("diff");
    expect(shapeOf("@@ -1 +1 @@ alone")).toBe("text");
    expect(shapeOf("hola")).toBe("text");
  });

  it("reads a diff's lines as headers, hunks, additions and removals", () => {
    expect(["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1 +1 @@", "+new", "-old", " same"].map(hunkOf)).toEqual(["head", "head", "head", "hunk", "add", "del", ""]);
  });

  it("marks only lines that clearly report an error or a warning", () => {
    expect(["error: no such file", "error[E0308]: mismatched types", "Error: boom", "FAIL src/app.test.ts", "npm ERR! code 1", "TypeError: x is undefined", "fatal: not a git repository"].map(cueOf)).toEqual(
      Array(7).fill("error"),
    );
    expect(["warning: unused variable", "WARN deprecated", "npm WARN old"].map(cueOf)).toEqual(["warning", "warning", "warning"]);
    expect(["0 errors", "no warnings here", "errored = false", "Compiling sens v0.21.0"].map(cueOf)).toEqual(["", "", "", ""]);
  });

  it("finds web addresses and file places with a line, never one inside the other", () => {
    const line = "see https://example.com/a_(b). and src/app.ts:12:5, C:\\demo\\main.rs:3 or http://localhost:5173/x.js:1";
    expect(marksOf(line).map((mark) => mark.url ?? mark.path)).toEqual(["https://example.com/a_(b)", "src/app.ts", "C:\\demo\\main.rs", "http://localhost:5173/x.js:1"]);
    expect(marksOf("at 12:30:45 and v1.2:3 and localhost:5173")).toEqual([]);
    expect(marksOf("src/app.ts:4", false)).toEqual([]);
  });

  it("cuts styled runs at any column", () => {
    const bold = { bold: true };
    expect(within([["ab", null], ["cd", bold], ["ef", null]], 1, 5)).toEqual([["b", null], ["cd", bold], ["e", null]]);
  });
});
