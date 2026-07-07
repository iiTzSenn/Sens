import { defineConfig } from "tsup";
import { mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { GRAMMAR_NAMES } from "./src/indexer/languages/grammars.js";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node18",
  clean: true,
  // No .d.ts for now: Sens ships as a CLI + MCP server, not a typed library.
  // Re-enable when/if we expose a public typed API.
  dts: false,
  sourcemap: true,
  // Copy every tree-sitter grammar WASM next to the build output so the
  // published package carries them (tree-sitter-wasms is only a dev dependency).
  // The web-tree-sitter runtime WASM ships with its own package (a real dep).
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
