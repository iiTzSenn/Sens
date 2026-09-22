import { defineConfig } from "tsup";
import { mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { GRAMMAR_NAMES } from "./src/indexer/languages/grammars.js";

const pkg = createRequire(import.meta.url)("./package.json") as { version: string };

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
    hook: "src/hook-entry.ts",
  },
  format: ["esm"],
  target: "node18",
  clean: true,
  define: { __SENS_VERSION__: JSON.stringify(pkg.version) },
  dts: false,
  sourcemap: true,
  async onSuccess() {
    const require = createRequire(import.meta.url);
    const outDir = path.resolve("dist", "grammars");
    await mkdir(outDir, { recursive: true });
    for (const name of GRAMMAR_NAMES) {
      const file = `tree-sitter-${name}.wasm`;
      const src = require.resolve(`tree-sitter-wasms/out/${file}`);
      await copyFile(src, path.join(outDir, file));
    }
  },
});
