import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // PostgreSQL integration suites share one disposable database in CI. Run
    // files sequentially so unrelated Serializable fixtures cannot create
    // cross-suite P2034 flakes; individual tests still exercise explicit
    // concurrency where the invariant requires it.
    fileParallelism: false,
    restoreMocks: true,
  },
});
