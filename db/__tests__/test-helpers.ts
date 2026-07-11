import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * TRUNCATE（而非 DELETE）绕过我们自己的 append-only 触发器，
 * 是测试之间重置状态的干净方式。
 *
 * Phase3-开工计划.md 决策 J：这道库名护栏是"绝不清掉 dogfooding 图"的
 * 兜底。db/client.ts 已保证 vitest 下连的是 DATABASE_URL_TEST，但万一
 * 有人把 DATABASE_URL_TEST 指错了库（指到 dev/主库），这里再拦一道——
 * 当前连接的库名不含 `_test` 就直接抛错，绝不 TRUNCATE。真实（authoritative）
 * 判断源是数据库自己报的 current_database()，不是 URL 字符串。
 */
export async function resetGraph() {
  const [{ current_database: dbName }] = (await db.execute(
    sql`SELECT current_database()`,
  )) as unknown as Array<{ current_database: string }>;
  if (!dbName || !dbName.includes("_test")) {
    throw new Error(
      `resetGraph() 拒绝在库 "${dbName}" 上 TRUNCATE：只允许库名含 "_test" 的测试库。` +
        `这是防止清掉 dogfooding 图的护栏（Phase3 决策 J）。请确认 DATABASE_URL_TEST 指向测试库。`,
    );
  }
  await db.execute(
    sql`TRUNCATE TABLE events, audit_log, provenance, edges, nodes RESTART IDENTITY CASCADE`,
  );
}

/**
 * postgres-js 把驱动层错误包在 `.cause` 里，顶层 `.message` 只是
 * "Failed query: ..."。真正的 RAISE EXCEPTION 文本要看 `.cause.message`。
 */
export function pgErrorMessage(err: unknown): string {
  const cause = (err as { cause?: { message?: string } })?.cause;
  return cause?.message ?? String(err);
}

export const TEST_PROJECT = "00000000-0000-0000-0000-000000000001";
