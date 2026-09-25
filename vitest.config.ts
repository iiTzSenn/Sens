import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "rust/sens-app/ui/src/**/*.test.{ts,tsx,js}"],
    setupFiles: ["rust/sens-app/ui/src/dev/test-setup.ts"],
  },
});
