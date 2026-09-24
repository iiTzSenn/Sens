import { describe, expect, it } from "vitest";
import { fileIcon } from "./fileIcons";

describe("file icons", () => {
  it.each([
    ["main.py", "python"],
    ["README.md", "readme"],
    ["notes.md", "markdown"],
    ["src/app.tsx", "react_ts"],
    ["types.d.ts", "typescript-def"],
    ["lib.rs", "rust"],
    ["package.json", "nodejs"],
    ["Dockerfile", "docker"],
    [".gitignore", "git"],
    ["data.csv", "table"],
    ["C:\\proj\\scripts\\build.PS1", "powershell"],
    ["no-extension-at-all", "file"],
    ["archivo.desconocido", "file"],
  ])("gives %s the %s icon", (path, icon) => {
    expect(fileIcon(path)).toBe(`/file-icons/${icon}.svg`);
  });
});
