// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolDetail, ToolInput } from "../../ipc/types";
import { shell } from "../../app/shell";
import { showLanguage } from "../../shared/i18n";
import { paintCode } from "../../shared/syntax/code";
import { paint } from "../../shared/syntax/paint";
import { project } from "../project/store";
import { keepReading } from "../terminal/readings";
import { Ask } from "./Ask";
import { Step } from "./Step";
import type { Step as StepPart } from "./turns";

const ipc = vi.hoisted(() => ({ commands: { openFile: vi.fn(), openExternal: vi.fn(), chatAnswer: vi.fn() } }));

vi.mock("../../ipc/commands", () => ({ commands: ipc.commands, events: {} }));

const ESC = "\x1b";
const FUNCTION = "light-dark(rgb(121, 94, 38), rgb(220, 220, 170))";

const step = (name: string, input: ToolInput, output = "", detail: ToolDetail | null = null, state: StepPart["state"] = "done"): StepPart => ({
  kind: "step",
  key: 1,
  id: "t1",
  name,
  input,
  state,
  output,
  detail,
  links: [],
  began: null,
  ended: null,
});

const closed = (part: StepPart) => render(<Step part={part} />).container.querySelector("details.step") as HTMLDetailsElement;
const drawn = (part: StepPart) => {
  const box = closed(part);
  if (!box.open) fireEvent.click(box.querySelector("summary")!);
  return box;
};
const spanOf = (inside: Element, text: string) => [...inside.querySelectorAll("span")].find((span) => span.textContent === text) as HTMLElement | undefined;

beforeEach(() => {
  project.setState({ root: "C:/demo", work: "C:/demo" });
  shell.setState(shell.getInitialState(), true);
  for (const command of Object.values(ipc.commands)) command.mockReset().mockResolvedValue(undefined);
  ipc.commands.openFile.mockResolvedValue({ kind: "text", text: "" });
});

afterEach(() => {
  cleanup();
  showLanguage("es");
});

describe("a command Claude ran", () => {
  it("shows the command colored as its shell, behind that shell's prompt", async () => {
    await act(async () => {
      await paintCode("git status --short", "shellscript");
      await paintCode("Get-ChildItem -Name", "powershell");
    });
    const bash = drawn(step("Bash", { command: "git status --short" }, "", { stdout: "", stderr: "" }));
    expect(bash.querySelector(".terminal-command")?.textContent).toBe("$git status --short");
    expect(spanOf(bash.querySelector(".terminal-command")!, "git")?.style.color).toBe(FUNCTION);
    expect(spanOf(bash.querySelector(".step-target")!, "git")?.style.color).toBe(FUNCTION);
    expect(bash.querySelector(".terminal-foot")?.textContent).toBe("Sin salida");

    const pwsh = drawn(step("PowerShell", { command: "Get-ChildItem -Name" }, "", { stdout: "notas.txt", stderr: "" }));
    expect(pwsh.querySelector(".terminal")?.getAttribute("data-shell")).toBe("powershell");
    expect(pwsh.querySelector(".terminal-command")?.textContent).toBe("PS>Get-ChildItem -Name");
    expect(spanOf(pwsh.querySelector(".terminal-command")!, "Get-ChildItem")?.style.color).toBe(FUNCTION);
  });

  it("colors the one-line summary once its colors arrive, keeping the same text", async () => {
    const part = step("Bash", { command: "npm   run\n  lint" }, "", null, "running");
    const summary = drawn(part).querySelector(".step-target")!;
    expect(summary.textContent).toBe("npm run lint");
    expect(summary.querySelector("span")).toBeNull();
    await act(async () => {
      await paintCode("npm run lint", "shellscript");
      await new Promise((done) => setTimeout(done));
    });
    expect(summary.textContent).toBe("npm run lint");
    expect(spanOf(summary, "npm")?.style.color).toBe(FUNCTION);
  });

  it("draws ANSI colors and styles from the output with the terminal palette, dropping other controls", () => {
    const stdout = `${ESC}]0;title${ESC}\\${ESC}[1;31mfailed${ESC}[0m in ${ESC}[38;5;208m2s${ESC}[0m\n${ESC}[32m✓${ESC}[39m ok${ESC}[K`;
    const out = drawn(step("Bash", { command: "npm test" }, "", { stdout, stderr: "" })).querySelector(".terminal-output")!;
    expect(out.textContent).toBe("failed in 2s\n✓ ok");
    const failed = spanOf(out, "failed")!;
    expect(failed.style.color).toBe("var(--ansi-red, var(--red))");
    expect(failed.className).toBe("ansi-bold");
    expect(spanOf(out, "2s")!.className).toBe("ansi-rgb");
    expect(spanOf(out, "2s")!.style.getPropertyValue("--fg")).toBe("rgb(255 135 0)");
    expect(spanOf(out, "✓")!.style.color).toBe("var(--ansi-green, var(--green))");
    expect(out.querySelector(".cue-error")).toBeNull();
  });

  it("marks clear errors and warnings in plain output, and opens the files it names", async () => {
    const stdout = "Compiling sens\nwarning: unused import\nerror[E0425]: cannot find value\n  --> src/main.rs:3:9\nsee https://doc.rust-lang.org/error_codes";
    const ran = drawn(step("Bash", { command: "cargo build" }, "", { stdout, stderr: "" }, "failed"));
    const out = ran.querySelector(".terminal-output")!;
    expect(out.textContent).toBe(stdout);
    expect(out.querySelector(".cue-warning")?.textContent).toBe("warning: unused import");
    expect(out.querySelector(".cue-error")?.textContent).toBe("error[E0425]: cannot find value");
    expect(out.querySelector("a")?.getAttribute("href")).toBe("https://doc.rust-lang.org/error_codes");
    fireEvent.click(out.querySelector("a")!);
    expect(ipc.commands.openExternal).toHaveBeenCalledWith("https://doc.rust-lang.org/error_codes");
    await act(async () => fireEvent.click(out.querySelector(".place")!));
    expect(shell.getState()).toMatchObject({ toolsOpen: true, tool: "files" });
    expect(ipc.commands.openFile).toHaveBeenCalledWith("C:/demo", "src/main.rs");
  });

  it("reads JSON as JSON and a diff as a diff", async () => {
    const json = '{"name": "sens", "private": true}';
    await act(async () => {
      await paint(json, "json");
    });
    const out = drawn(step("Bash", { command: "cat package.json" }, "", { stdout: json, stderr: "" })).querySelector(".terminal-output")!;
    expect(out.textContent).toBe(json);
    expect(spanOf(out, "true")?.style.color).toBe("light-dark(rgb(0, 0, 255), rgb(86, 156, 214))");

    const diff = ["diff --git a/x.ts b/x.ts", "--- a/x.ts", "+++ b/x.ts", "@@ -1 +1 @@", "-old", "+new"].join("\n");
    const lines = drawn(step("Bash", { command: "git diff" }, "", { stdout: diff, stderr: "" })).querySelector(".terminal-output")!;
    expect([...lines.querySelectorAll("[class^=diff-]")].map((line) => line.className)).toEqual(["diff-head", "diff-head", "diff-head", "diff-hunk", "diff-del", "diff-add"]);
  });

  it("tints what went to stderr red only when the command failed", () => {
    const quiet = drawn(step("Bash", { command: "git push" }, "", { stdout: "", stderr: "To github.com:sens.git" }));
    expect(quiet.querySelector(".stderr")).toBeNull();
    expect(quiet.querySelector(".terminal-output")?.textContent).toBe("To github.com:sens.git");
    const loud = drawn(step("Bash", { command: "git push" }, "", { stdout: "1 failed", stderr: "boom" }, "failed"));
    expect(loud.querySelector(".stderr")?.textContent).toBe("boom");
    expect(loud.querySelector(".terminal-foot")?.textContent).toBe("Terminó con error");
  });

  it("shows what Claude read from the terminal in its colors", () => {
    const said = "Terminal 1 · pwsh en C:/demo\n\nFAIL src/app.test.ts";
    keepReading(said, `Terminal 1 · pwsh en C:/demo\n\n${ESC}[0;31mFAIL src/app.test.ts${ESC}[0m`);
    const read = drawn(step("mcp__sens__read_terminal", {}, said));
    expect(read.querySelector(".step-verb")?.textContent).toBe("Leer la terminal");
    expect(read.querySelector(".out")?.textContent).toBe(said);
    expect(spanOf(read.querySelector(".out")!, "FAIL src/app.test.ts")?.style.color).toBe("var(--ansi-red, var(--red))");
  });

  it("speaks the language chosen", () => {
    showLanguage("en");
    const bash = drawn(step("Bash", { command: "true" }, "", { stdout: "", stderr: "" }));
    expect(bash.querySelector(".step-verb")?.textContent).toBe("Run");
    expect(bash.querySelector(".terminal-foot")?.textContent).toBe("No output");
    showLanguage("de");
    const read = drawn(step("Read", { file_path: "C:/demo/a.ts" }, "", { file: { numLines: 3 } }));
    expect(read.querySelector(".step-meta")?.textContent).toBe("3 Zeilen");
  });
});

describe("a step", () => {
  it("draws what it did only once opened, opens by itself when it failed, and never opens with nothing to show", () => {
    const ran = closed(step("Bash", { command: "ls" }, "", { stdout: "notas.txt", stderr: "" }));
    expect(ran.open).toBe(false);
    expect(ran.className).toBe("step");
    expect(ran.querySelector(".step-body")?.childElementCount).toBe(0);
    fireEvent.click(ran.querySelector("summary")!);
    expect(ran.open).toBe(true);
    expect(ran.querySelector(".terminal-output")?.textContent).toBe("notas.txt");

    const failed = closed(step("Bash", { command: "npm test" }, "", { stdout: "", stderr: "boom" }, "failed"));
    expect(failed.open).toBe(true);
    expect(failed.querySelector(".stderr")?.textContent).toBe("boom");

    const read = closed(step("Read", { file_path: "C:/demo/a.ts" }, "", { file: { numLines: 3 } }));
    expect(read.className).toBe("step empty");
    fireEvent.click(read.querySelector("summary")!);
    expect(read.open).toBe(false);
  });
});

describe("a permission question", () => {
  const asking = (tool: string, input: ToolInput) => (
    <Ask part={{ kind: "ask", key: 1, event: { kind: "asking", request: "r1", tool, input, suggestions: null }, active: true, state: "waiting", answers: null }} reply={0} />
  );

  it("is one sentence each language builds whole, over the command in its shell", () => {
    const { container, unmount } = render(asking("PowerShell", { command: "Remove-Item dist -Recurse" }));
    expect(container.querySelector(".ask-title")?.textContent).toBe("Claude quiere ejecutar");
    expect(container.querySelector(".terminal-command")?.textContent).toBe("PS>Remove-Item dist -Recurse");
    unmount();
    showLanguage("ja");
    const japanese = render(asking("mcp__github__create_issue", {})).container;
    expect(japanese.querySelector(".ask-title")?.textContent).toBe("Claude が github を使おうとしています");
    expect([...japanese.querySelectorAll(".ask-actions button")].map((button) => button.textContent)).toEqual(["許可", "拒否"]);
  });
});
