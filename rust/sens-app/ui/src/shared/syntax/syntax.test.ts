// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { languageNamed, languageOf } from "./languages";
import { paint, paintedNow, paintRows } from "./paint";

// Dark+, as VS Code paints them.
const KEYWORD = "#569cd6";
const STRING = "#ce9178";
const COMMENT = "#6a9955";
const CONTROL = "#c586c0";

const colorsOf = (painted: Awaited<ReturnType<typeof paint>>) => {
  const out: Record<string, string> = {};
  for (const line of painted!.lines) for (const [text, look] of line) if (look >= 0) out[text.trim()] = painted!.looks[look].color.toLowerCase();
  return out;
};

describe("languages", () => {
  it("are known by name, then by the longest extension, then by the shebang", () => {
    expect(languageOf("src/main.py")).toBe("python");
    expect(languageOf("C:\\app\\Button.TSX")).toBe("tsx");
    expect(languageOf("types/index.d.ts")).toBe("typescript");
    expect(languageOf("Dockerfile")).toBe("docker");
    expect(languageOf("Cargo.lock")).toBe("toml");
    expect(languageOf("tsconfig.json")).toBe("jsonc");
    expect(languageOf("include/app.h")).toBe("cpp");
    expect(languageOf("bin/deploy", "#!/usr/bin/env python3\nprint(1)")).toBe("python");
    expect(languageOf("bin/run", "#!/bin/bash -e\n")).toBe("shellscript");
    expect(languageOf("notes.txt")).toBeNull();
    expect(languageOf("constructor")).toBeNull();
  });

  it("are known by a code fence's tag", () => {
    expect(languageNamed("ts")).toBe("typescript");
    expect(languageNamed("Python")).toBe("python");
    expect(languageNamed("console")).toBe("shellsession");
    expect(languageNamed("ps1")).toBe("powershell");
    expect(languageNamed("c#")).toBe("csharp");
    expect(languageNamed("")).toBeNull();
    expect(languageNamed("text")).toBeNull();
  });
});

describe("painting", () => {
  it("colors code as VS Code's Dark+ does, keeping every character", async () => {
    const text = 'def greet(name):\n    return "hola"  # saludo\n';
    const painted = await paint(text, "python");
    expect(painted!.lines.map((line) => line.map(([part]) => part).join("")).join("\n")).toBe(text);
    expect(colorsOf(painted)).toMatchObject({ def: KEYWORD, return: CONTROL, '"hola"': STRING, "# saludo": COMMENT });
    expect(paintedNow(text, "python")).toBe(painted);
  });

  it("leaves text plain when it has no grammar", async () => {
    expect(await paint("hola", null)).toBeNull();
    expect(await paint("hola", "no-such-language")).toBeNull();
  });

  it("skips a text no longer wanted when its turn comes", async () => {
    expect(await paint("let skipped = 1;", "javascript", () => false)).toBeNull();
    expect(paintedNow("let skipped = 1;", "javascript")).toBeNull();
  });

  it("reads a diff's removed rows as the file before and the rest as the file after", async () => {
    const rows = [
      { kind: "", text: "/* a note" },
      { kind: "del", text: "   still the note */" },
      { kind: "add", text: "   ends here */ const x = 1;" },
      { kind: "gap", text: "" },
    ];
    const painted = await paintRows(rows, "javascript");
    expect(painted[3]).toBeNull();
    const colorOf = (at: number, part: string) => {
      const run = painted[at]!.runs.find(([text]) => text.includes(part))!;
      return run[1] < 0 ? "" : painted[at]!.looks[run[1]].color.toLowerCase();
    };
    expect(colorOf(1, "still")).toBe(COMMENT);
    expect(colorOf(2, "ends")).toBe(COMMENT);
    expect(colorOf(2, "const")).toBe(KEYWORD);
  });
});
