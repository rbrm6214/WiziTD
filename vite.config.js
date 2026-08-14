import { defineConfig } from "vite";

// Explicit project base for GitHub Pages repository deployment.
export default defineConfig({
  base: "/WiziTD/",
  build: {
    outDir: "docs",
    emptyOutDir: true,
  },
});
