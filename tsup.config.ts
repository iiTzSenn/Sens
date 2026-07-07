import { defineConfig } from "tsup";

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
});
