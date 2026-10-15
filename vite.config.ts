import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  // Isolated QA builds also contain HTML; scan only the real application entry.
  optimizeDeps: { entries: ["index.html"] },
  build: { outDir: "dist/renderer", emptyOutDir: true, manifest: true },
  server: { host: "127.0.0.1" },
});
