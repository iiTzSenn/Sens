import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const require = createRequire(import.meta.url);

describe("file icons", () => {
  it("come from the material-icon-theme installed", () => {
    const { version } = JSON.parse(readFileSync(require.resolve("material-icon-theme/package.json"), "utf8"));
    const table = JSON.parse(readFileSync(path.join(root, "rust/sens-app/ui/src/shared/file-icons.json"), "utf8"));
    expect(table.version, "run npm run icons -w sens-app-ui").toBe(version);
  });
});
