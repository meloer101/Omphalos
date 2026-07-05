import { config } from "dotenv";
import { defineConfig } from "vitest/config";
import path from "node:path";

config({ path: ".env.local" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
