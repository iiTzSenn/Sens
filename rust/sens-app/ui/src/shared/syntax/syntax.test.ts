// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { codeNow, paintCode } from "./code";
import { languageNamed, languageOf, titleOf } from "./languages";
import { paint, paintedNow, paintRows } from "./paint";

const KEYWORD = "light-dark(#0000ff, #569cd6)";
const STRING = "light-dark(#a31515, #ce9178)";
const COMMENT = "light-dark(#008000, #6a9955)";
const CONTROL = "light-dark(#af00db, #c586c0)";
const FUNCTION = "light-dark(#795e26, #dcdcaa)";

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

  it("know every name a shell or a console goes by in a fence", () => {
    const tags = ["ps1", "pwsh", "powershell", "bash", "sh", "shell", "zsh", "fish", "console", "shell-session", "terminal", "cmd", "bat", "batch", "dos", "nu"];
    expect(tags.map(languageNamed)).toEqual([
      "powershell",
      "powershell",
      "powershell",
      "shellscript",
      "shellscript",
      "shellscript",
      "shellscript",
      "fish",
      "shellsession",
      "shellsession",
      "shellsession",
      "bat",
      "bat",
      "bat",
      "bat",
      "nushell",
    ]);
  });

  it("are called by their proper names", () => {
    expect(["ts", "ps1", "bash", "zsh", "sh", "cmd", "bat", "json", "c#", "nu", "text", "whatever"].map(titleOf)).toEqual([
      "TypeScript",
      "PowerShell",
      "Bash",
      "Zsh",
      "Shell",
      "CMD",
      "Batch",
      "JSON",
      "C#",
      "Nushell",
      null,
      null,
    ]);
  });
});

describe("painting", () => {
  it("colors code as VS Code's Light+ and Dark+ do, keeping every character", async () => {
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

describe("commands", () => {
  const textOf = (painted: Awaited<ReturnType<typeof paintCode>>) => painted!.lines.map((line) => line.map(([part]) => part).join("")).join("\n");

  it("color what another shell runs inside a command as that shell, and the rest as the outer one", async () => {
    const command = 'powershell -NoProfile -Command "Get-Process | Select-Object -First 3" && echo done';
    const painted = await paintCode(command, "shellscript");
    expect(textOf(painted)).toBe(command);
    expect(colorsOf(painted)).toMatchObject({ powershell: FUNCTION, "Get-Process": FUNCTION, "Select-Object": FUNCTION, '"': STRING, echo: FUNCTION, done: STRING });
    expect(codeNow(command, "shellscript")).toBe(painted);
  });

  it("color a heredoc as the program that reads it", async () => {
    const command = "python3 - <<'EOF'\nimport sys\nEOF";
    const painted = await paintCode(command, "shellscript");
    expect(textOf(painted)).toBe(command);
    expect(colorsOf(painted)).toMatchObject({ import: CONTROL });
  });

  it("paint a plain command once and have it at hand after", async () => {
    expect(codeNow("git status --short", "shellscript")).toBeNull();
    const painted = await paintCode("git status --short", "shellscript");
    expect(colorsOf(painted)).toMatchObject({ git: FUNCTION, "--short": KEYWORD });
    expect(codeNow("git status --short", "shellscript")).toBe(painted);
    expect(await paintCode("", "shellscript")).toBeNull();
  });
});
