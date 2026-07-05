import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * TRUNCATE（而非 DELETE）绕过我们自己的 append-only 触发器，
 * 是测试之间重置状态的干净方式。
 */
export async function resetGraph() {
  await db.execute(
    sql`TRUNCATE TABLE audit_log, provenance, edges, nodes RESTART IDENTITY CASCADE`,
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
