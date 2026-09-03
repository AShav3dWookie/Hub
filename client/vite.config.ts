import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // We hand-write the service worker (custom nav fallback + /api routing, and the
      // thumbnail/original image caches in later branches) — Workbox helpers, not generateSW.
      strategies: "injectManifest",
      srcDir: "src/sw",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: null, // we register via virtual:pwa-register in main.tsx
      devOptions: { enabled: false }, // no service worker under `vite dev`
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: "Logger",
        short_name: "Logger",
        description: "Personal log of movies, TV, meals, books and games",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  build: {
    outDir: "dist",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
