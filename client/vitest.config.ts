import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // `virtual:pwa-register` only exists during a real Vite build (vite-plugin-pwa).
      "virtual:pwa-register": fileURLToPath(new URL("./src/test/pwaRegisterStub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts", "./src/test/setupLocal.ts"],
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/main.tsx", "src/test/**", "src/vite-env.d.ts", "src/sw/**"],
      // Set a couple of points below what the suite currently reaches, so a real regression
      // fails the run without ordinary refactoring tripping it on rounding.
      thresholds: { statements: 87, branches: 83, functions: 82, lines: 87 },
    },
  },
});
