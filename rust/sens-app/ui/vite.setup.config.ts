import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: { port: 5174, strictPort: true },
  build: {
    outDir: "dist-setup",
    emptyOutDir: true,
    rollupOptions: { input: "setup.html" },
  },
  plugins: [
    {
      name: "sens-setup-mock",
      apply: "serve",
      transformIndexHtml: () => [{ tag: "script", attrs: { type: "module", src: "/src/setup/mock.ts" }, injectTo: "head" }],
    },
  ],
});
