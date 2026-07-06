import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { getDbReadonly } from "@/db/client";
import { TEST_PROJECT as PROJECT } from "./test-helpers";

/**
 * 双凭证（Phase1-开工计划.md 1.0，Agent架构设计.md 5.2）：检索合同要求
 * 的物理只读连接，P1 建好待用（P2 检索合同才有消费方）。这里只验证
 * 一件事——"安全靠构造，不靠模型自觉"：物理上就写不进去，不是靠应用层
 * 记得不调用写方法。
 */
describe("只读数据库凭证（db/migrations/0003_readonly_role.sql）", () => {
  it("可以 SELECT", async () => {
    const dbReadonly = getDbReadonly();
    const rows = await dbReadonly.execute(sql`select 1 as one`);
    expect(rows).toBeDefined();
  });

  it("INSERT 被数据库物理拒绝", async () => {
    const dbReadonly = getDbReadonly();
    await expect(
      dbReadonly.execute(
        sql`insert into nodes (type, project_id, title) values ('evidence', ${PROJECT}, 'should not be allowed')`,
      ),
    ).rejects.toThrow();
  });

  it("UPDATE / DELETE 同样被拒绝", async () => {
    const dbReadonly = getDbReadonly();
    await expect(
      dbReadonly.execute(sql`update nodes set title = 'x' where true`),
    ).rejects.toThrow();
    await expect(
      dbReadonly.execute(sql`delete from nodes where true`),
    ).rejects.toThrow();
  });
});
