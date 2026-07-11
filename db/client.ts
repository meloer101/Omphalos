import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Next.js loads .env.local itself; this is a no-op there but lets
// drizzle-kit / vitest (which run outside the Next.js runtime) see it too.
config({ path: ".env.local" });

/**
 * Phase3-开工计划.md 决策 J（拆库）：测试与 dev/dogfooding 物理分库。
 * 在 vitest 下（`process.env.VITEST`）**强制**走独立测试库 `DATABASE_URL_TEST`，
 * 且缺失即抛错——绝不静默回退到 DATABASE_URL。否则 `resetGraph()` 的 TRUNCATE
 * 会清掉积累数周的 dogfooding 图。resetGraph 里还有一道库名护栏兜底。
 */
const isTest = !!process.env.VITEST;

const connectionString = isTest
  ? process.env.DATABASE_URL_TEST
  : process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    isTest
      ? "DATABASE_URL_TEST is not set — 测试必须连独立测试库，不能碰 dev 库（见 .env.example / 决策 J）"
      : "DATABASE_URL is not set (see .env.example)",
  );
}

const client = postgres(connectionString);
export const db = drizzle(client, { schema });

/**
 * 只读连接（db/migrations/0003_readonly_role.sql）——检索合同的物理只读
 * 凭证（Agent架构设计.md 5.2）。P1 建好待用，P2 检索合同接入前不会有
 * 消费方。惰性构造，理由同上：独立脚本里 import 提升会跑在 dotenv
 * config() 之前。
 */
let dbReadonlyInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDbReadonly() {
  if (!dbReadonlyInstance) {
    // 决策 J：只读连接同样在测试下走测试库的只读凭证，避免检索类测试
    // （readonly-role.test.ts 等）读到 dev 库数据造成跨库污染。
    const readonlyUrl = isTest
      ? process.env.DATABASE_URL_READONLY_TEST
      : process.env.DATABASE_URL_READONLY;
    if (!readonlyUrl) {
      throw new Error(
        isTest
          ? "DATABASE_URL_READONLY_TEST is not set（见 .env.example / 决策 J）"
          : "DATABASE_URL_READONLY is not set (see .env.example)",
      );
    }
    dbReadonlyInstance = drizzle(postgres(readonlyUrl), { schema });
  }
  return dbReadonlyInstance;
}
