import { defineConfig } from "vitest/config";

export default defineConfig({
  // Worker tests have their own dependencies, configuration and CI job.
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
