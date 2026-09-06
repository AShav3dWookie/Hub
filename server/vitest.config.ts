import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/scripts/**", "src/testUtils/**"],
      // Set a couple of points below what the suite currently reaches, so a real regression
      // fails the run without ordinary refactoring tripping it on rounding.
      thresholds: { statements: 95, branches: 91, functions: 90, lines: 95 },
    },
  },
});
