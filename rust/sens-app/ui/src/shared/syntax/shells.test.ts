import { describe, expect, it } from "vitest";
import { nestsOf, promptOf, sessionOf, shellOf } from "./shells";

const nested = (text: string, language: string) => nestsOf(text, language).map((nest) => [text.slice(nest.from, nest.to), nest.language]);

describe("shells", () => {
  it("follow the tool that ran the command, or guess PowerShell by its look", () => {
    expect(shellOf("Bash", "Get-ChildItem")).toBe("bash");
    expect(shellOf("PowerShell", "ls")).toBe("powershell");
    expect(shellOf("", "Get-ChildItem -Recurse | Select-Object -First 3")).toBe("powershell");
    expect(shellOf("", "$env:PATH")).toBe("powershell");
    expect(shellOf("", "npm test")).toBe("bash");
    expect([promptOf("bash"), promptOf("powershell"), promptOf("cmd")]).toEqual(["$", "PS>", ">"]);
  });

  it("find code another program runs inside a command", () => {
    expect(nested('powershell -NoProfile -Command "Get-Process | Select-Object -First 3" && echo done', "shellscript")).toEqual([["Get-Process | Select-Object -First 3", "powershell"]]);
    expect(nested("pwsh.exe -c 'Add-Type -AssemblyName UIAutomationClient'", "shellscript")).toEqual([["Add-Type -AssemblyName UIAutomationClient", "powershell"]]);
    expect(nested('cmd //c "dir /b" | head', "shellscript")).toEqual([["dir /b", "bat"]]);
    expect(nested("cmd /c dir /s && ls", "shellscript")).toEqual([["dir /s", "bat"]]);
    expect(nested("bash -lc 'echo $HOME'", "powershell")).toEqual([["echo $HOME", "shellscript"]]);
    expect(nested('python3 -c "print(\\"hi\\")"', "shellscript")).toEqual([['print(\\"hi\\")', "python"]]);
    expect(nested('node -e "console.log(1)"', "shellscript")).toEqual([["console.log(1)", "javascript"]]);
    expect(nested("npm test", "shellscript")).toEqual([]);
    expect(nested('pwsh -c "x"', "typescript")).toEqual([]);
  });

  it("read a heredoc as what reads it or the file it writes", () => {
    expect(nested("python3 - <<'EOF'\nimport sys\nprint(sys.argv)\nEOF\necho after", "shellscript")).toEqual([["import sys\nprint(sys.argv)", "python"]]);
    expect(nested('cat > config.json <<EOF\n{"a": 1}\nEOF', "shellscript")).toEqual([['{"a": 1}', "json"]]);
    expect(nested("cat <<-END | tee notes.py\n\tx = 1\n\tEND", "shellscript")).toEqual([["\tx = 1", "python"]]);
    expect(nested("git commit -m \"$(cat <<'EOF'\nfix: the thing\nEOF\n)\"", "shellscript")).toEqual([]);
  });

  it("recognize a console session: prompts, the command in its shell, and what it printed", () => {
    const text = ["PS C:\\Users\\sofia\\PRUEBASENS> Get-ChildItem", "", "    Directory: C:\\Users", "PS C:\\Users\\sofia\\PRUEBASENS> function f {", ">> 1 }", "C:\\demo>dir /b", "a.txt"].join("\n");
    expect(sessionOf(text)).toEqual([
      { prompt: "PS C:\\Users\\sofia\\PRUEBASENS> ", text: "Get-ChildItem", shell: "powershell" },
      { prompt: "", text: "", shell: null },
      { prompt: "", text: "    Directory: C:\\Users", shell: null },
      { prompt: "PS C:\\Users\\sofia\\PRUEBASENS> ", text: "function f {", shell: "powershell" },
      { prompt: ">> ", text: "1 }", shell: "powershell" },
      { prompt: "C:\\demo>", text: "dir /b", shell: "cmd" },
      { prompt: "", text: "a.txt", shell: null },
    ]);
    expect(sessionOf("$ npm install \\\n  --save-dev vitest\nadded 1 package", "bash")?.map((line) => line.shell)).toEqual(["bash", "bash", null]);
    expect(sessionOf("sofia@box:~/sens$ ls\n❯ git status")?.map((line) => [line.prompt, line.shell])).toEqual([
      ["sofia@box:~/sens$ ", "bash"],
      ["❯ ", "bash"],
    ]);
  });

  it("leave code that only looks like a session alone", () => {
    expect(sessionOf("const a = 1;")).toBeNull();
    expect(sessionOf("$ npm test", "ts")).toBeNull();
    expect(sessionOf("$ErrorActionPreference = 'Stop'", "powershell")).toBeNull();
    expect(sessionOf("npm ERR! missing script\n$ npm run dev", "console")?.map((line) => line.shell)).toEqual([null, "bash"]);
    expect(sessionOf("just output", "console")).toBeNull();
  });
});
