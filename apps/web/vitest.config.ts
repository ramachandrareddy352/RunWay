import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // happy-dom: much faster to start than jsdom on the WSL /mnt/c mount; threads avoid fork start-up cost.
  test: {
    environment: "happy-dom",
    globals: true,
    pool: "threads",
    include: ["test/**/*.test.tsx", "test/**/*.test.ts"],
  },
});
