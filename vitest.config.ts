import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup-env.ts"],
    testTimeout: 60000,
    hookTimeout: 120000,
    // Integration tests share one Postgres database, so files run sequentially.
    fileParallelism: false,
    pool: "forks",
  },
});
