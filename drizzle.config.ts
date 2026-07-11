import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

// Phase3-开工计划.md 决策 J：`DRIZZLE_TEST=1 drizzle-kit migrate` 把同一套
// 迁移应用到独立测试库（package.json 的 db:migrate:test）。不设时照常打 dev
// 主库。CI 里 .env.local 不存在，靠 workflow 注入的 env 变量。
const url = process.env.DRIZZLE_TEST
  ? process.env.DATABASE_URL_TEST
  : process.env.DATABASE_URL;

export default defineConfig({
  out: "./db/migrations",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: url!,
  },
});
