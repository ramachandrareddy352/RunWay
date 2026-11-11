import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained exit.html (BUILD_PLAN T5.6): no backend, pinnable to IPFS.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { outDir: "dist", rollupOptions: { input: "exit.html" } },
});
