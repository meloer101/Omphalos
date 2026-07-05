import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { edges, auditLog } from "@/db/schema";
import {
  createNode,
  createEdge,
  confirmEdge,
  getProvenance,
} from "@/lib/graph";

/**
 * 验收测试对应 Phase0-开工计划.md 0.1 的四条硬约束：
 * ① 非法边类型写入报错
 * ② 无出处的边写入被拒
 * ③ audit_log / 已确认记录不可 UPDATE/DELETE
 * ④ 出处链完整可查
 *
 * TRUNCATE（而非 DELETE）绕过我们自己的 append-only 触发器，
 * 是测试之间重置状态的干净方式。
 */
async function resetGraph() {
  await db.execute(
    sql`TRUNCATE TABLE audit_log, provenance, edges, nodes RESTART IDENTITY CASCADE`,
  );
}

/**
 * postgres-js 把驱动层错误包在 `.cause` 里，顶层 `.message` 只是
 * "Failed query: ..."。真正的 RAISE EXCEPTION 文本要看 `.cause.message`。
 */
function pgErrorMessage(err: unknown): string {
  const cause = (err as { cause?: { message?: string } })?.cause;
  return cause?.message ?? String(err);
}

const PROJECT = "00000000-0000-0000-0000-000000000001";

describe("图内核硬约束", () => {
  beforeEach(resetGraph);
  afterAll(resetGraph);

  it("① 非法边类型写入直接报错（DB 原生枚举约束）", async () => {
    const a = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "用户反馈：想要微信支付",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const b = await createNode({
      type: "feature",
      projectId: PROJECT,
      title: "结算页支持微信支付",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });

    await expect(
      db.execute(
        sql`INSERT INTO edges (type, risk, src_id, dst_id, project_id)
            VALUES ('not_a_real_type', 'low', ${a.id}, ${b.id}, ${PROJECT})`,
      ),
    ).rejects.toThrow();
  });

  it("② 绕过 lib/graph 直接插入无出处的边，被 DB 约束拒绝", async () => {
    const a = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "证据",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const b = await createNode({
      type: "feature",
      projectId: PROJECT,
      title: "需求",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });

    // 故意绕过 lib/graph.createEdge，直接插入边但不插入 provenance —
    // deferred constraint trigger 应在事务提交时报错。
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(edges).values({
          type: "supports",
          risk: "high",
          srcId: a.id,
          dstId: b.id,
          projectId: PROJECT,
        });
      }),
    ).rejects.toThrow(/no provenance row/);
  });

  it("③ audit_log 不可 UPDATE 也不可 DELETE（真正 append-only）", async () => {
    const node = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "证据",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });

    const [logRow] = await db
      .select()
      .from(auditLog)
      .where(sql`target_id = ${node.id}`);
    expect(logRow).toBeDefined();

    const updateErr = await db
      .execute(sql`UPDATE audit_log SET actor = 'someone-else' WHERE id = ${logRow.id}`)
      .catch((e) => e);
    expect(pgErrorMessage(updateErr)).toMatch(/append-only/);

    const deleteErr = await db
      .execute(sql`DELETE FROM audit_log WHERE id = ${logRow.id}`)
      .catch((e) => e);
    expect(pgErrorMessage(deleteErr)).toMatch(/append-only/);
  });

  it("③b 已确认的边不可被删除或改动关键字段", async () => {
    const a = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "证据",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const b = await createNode({
      type: "feature",
      projectId: PROJECT,
      title: "需求",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const edge = await createEdge({
      type: "supports",
      srcId: a.id,
      dstId: b.id,
      projectId: PROJECT,
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    await confirmEdge(edge.id, "human");

    const deleteErr = await db
      .delete(edges)
      .where(sql`id = ${edge.id}`)
      .catch((e) => e);
    expect(pgErrorMessage(deleteErr)).toMatch(/trust ledger/);

    const updateErr = await db
      .execute(sql`UPDATE edges SET dst_id = ${a.id} WHERE id = ${edge.id}`)
      .catch((e) => e);
    expect(pgErrorMessage(updateErr)).toMatch(/immutable/);
  });

  it("④ 出处链完整可查：谁创建、基于什么、置信度", async () => {
    const a = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "17 条反馈：想要微信支付",
      createdBy: "capture-agent",
      sourceRef: { kind: "agent", detail: { raw: "粘贴的原始反馈..." } },
      confidence: 0.86,
    });

    const prov = await getProvenance({ nodeId: a.id });
    expect(prov).toHaveLength(1);
    expect(prov[0].createdBy).toBe("capture-agent");
    expect(prov[0].confidence).toBeCloseTo(0.86);
    expect(prov[0].sourceRef).toMatchObject({ kind: "agent" });
  });

  it("提议边可被整体拒绝（删除），不留边但留 audit 记录", async () => {
    const a = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "证据",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const b = await createNode({
      type: "feature",
      projectId: PROJECT,
      title: "需求",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const edge = await createEdge({
      type: "supports",
      srcId: a.id,
      dstId: b.id,
      projectId: PROJECT,
      createdBy: "capture-agent",
      sourceRef: { kind: "agent", detail: {} },
    });

    const { rejectEdge } = await import("@/lib/graph");
    await rejectEdge(edge.id, "human");

    const remaining = await db
      .select()
      .from(edges)
      .where(sql`id = ${edge.id}`);
    expect(remaining).toHaveLength(0);
  });
});
