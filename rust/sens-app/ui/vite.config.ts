import { defineConfig } from "vite";

// tauri.conf.json loads this port in `tauri dev` and dist/ in `tauri build`.
// The dev server also loads a simulated Tauri first, so the shell runs in any
// browser; the build never includes it.
export default defineConfig({
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  plugins: [
    {
      name: "sens-mock-tauri",
      apply: "serve",
      transformIndexHtml: () => [
        { tag: "script", attrs: { type: "module", src: "/src/dev/mock-tauri.ts" }, injectTo: "head" },
      ],
    },
  ],
});
