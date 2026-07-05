import { config } from "dotenv";
import { defineConfig } from "vitest/config";
import path from "node:path";

config({ path: ".env.local" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    // 所有测试文件共享同一个本地 Postgres，且用 TRUNCATE 重置状态——
    // 并行跑多个文件会互相 TRUNCATE 对方的数据、甚至死锁。这不是
    // 孤立的单元测试，是对着真实数据库的集成测试，文件间必须串行。
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
