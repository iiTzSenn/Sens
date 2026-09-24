import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// The desktop shell's tables written from installed packages: each must match
// the version installed, or it names icons and grammars that moved.
const root = path.join(import.meta.dirname, "..");
const ui = path.join(root, "rust/sens-app/ui");
const require = createRequire(path.join(ui, "package.json"));
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("generated tables", () => {
  it("file icons come from the material-icon-theme installed", () => {
    const { version } = json(require.resolve("material-icon-theme/package.json"));
    expect(json(path.join(ui, "src/shared/file-icons.json")).version, "run npm run icons -w sens-app-ui").toBe(version);
  });

  it("languages come from the shiki and linguist-languages installed", () => {
    const table = json(path.join(ui, "src/shared/syntax/languages.json"));
    const linguist = json(path.join(path.dirname(require.resolve("linguist-languages")), "package.json"));
    expect(table.version, "run npm run languages -w sens-app-ui").toBe(json(require.resolve("shiki/package.json")).version);
    expect(table.linguist, "run npm run languages -w sens-app-ui").toBe(linguist.version);
  });
});
