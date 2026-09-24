/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";
import path from "node:path";

// Base path is "/" for local dev and the Capacitor APK (assets served from
// the app root), and "/shopflow-pos/" for the GitHub Pages project site.
// The Pages workflow sets VITE_BASE; everything else defaults to "/".
const base = process.env.VITE_BASE ?? "/";

const { version } = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as { version: string };

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "icon-maskable.svg"],
      manifest: {
        name: "ShopFlow POS",
        short_name: "ShopFlow",
        description: "Offline-first Point of Sale, billing & sales reports",
        theme_color: "#0f766e",
        background_color: "#0b1120",
        display: "standalone",
        orientation: "portrait",
        scope: base,
        start_url: base,
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
      },
    }),
  ],
});
