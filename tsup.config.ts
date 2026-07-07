import { defineConfig } from "tsup";
import { mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

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
  // Copy the Python grammar WASM next to the build output so the published
  // package carries it (tree-sitter-wasms is only a dev dependency). The
  // web-tree-sitter runtime WASM ships with its own package (a real dep).
  async onSuccess() {
    const require = createRequire(import.meta.url);
    const grammar = require.resolve("tree-sitter-wasms/out/tree-sitter-python.wasm");
    const outDir = path.resolve("dist", "grammars");
    await mkdir(outDir, { recursive: true });
    await copyFile(grammar, path.join(outDir, "tree-sitter-python.wasm"));
  },
});
