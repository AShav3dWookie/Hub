import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // `index.ts` is a re-export barrel and `types.ts` is interfaces only — neither
      // emits runtime code to cover.
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/types.ts"],
    },
  },
});
