import { defineConfig } from "vite";

// Base relative to support GitHub Pages project URLs like /<repo>/.
export default defineConfig({
  base: "./",
  build: {
    outDir: "docs",
    emptyOutDir: true,
  },
});
