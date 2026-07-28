import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies the admin endpoints to the local proxy daemon so the GUI
// can call fetch("/api/cost") in the browser without CORS. The daemon listens
// on DEFAULT_PROXY_PORT=3456 (packages/models/src/paths.ts); it is loopback-
// only, and the admin layer rejects non-loopback peers (server.ts isLoopback).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": "http://127.0.0.1:3456",
      "/health": "http://127.0.0.1:3456",
    },
  },
  // Tauri will host the built assets; for now a plain Vite build is enough to
  // validate the GUI↔admin pipeline in a browser.
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
