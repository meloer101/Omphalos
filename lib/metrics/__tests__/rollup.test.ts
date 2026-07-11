import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { auditLog, events } from "@/db/schema";
import { resetGraph, TEST_PROJECT } from "@/db/__tests__/test-helpers";
import {
  captureAcceptRate,
  highRiskMiswireRate,
  noRecordRate,
  citationClickRate,
  avgApprovalDurationMs,
} from "@/lib/metrics/rollup";

/**
 * Phase3-开工计划.md 3.2：rollup 是 Go/No-Go 的裁判，必须可脱 UI 单测。
 * 这里直接往 audit_log / events 里塞已知样本，断言五条聚合算得对——尤其
 * 那些"AI 提议 vs 人工创建""高风险边""低风险自动确认不计入"的边界。
 */

/** 造一对"AI 提议 → 人决定"的 audit 记录。 */
async function aiProposalDecided(opts: {
  targetType: "node" | "edge";
  decision: "confirmed" | "rejected";
  proposer?: string;
  edgeType?: string | null;
}) {
  const targetId = randomUUID();
  const proposer = opts.proposer ?? "capture";
  await db.insert(auditLog).values([
    {
      targetType: opts.targetType,
      targetId,
      action: "proposed",
      actor: proposer,
      edgeType: (opts.edgeType ?? null) as never,
    },
    {
      targetType: opts.targetType,
      targetId,
      action: opts.decision,
      actor: "human",
      edgeType: (opts.edgeType ?? null) as never,
    },
  ]);
  return targetId;
}

beforeEach(async () => {
  await resetGraph();
});

describe("rollup：捕获接受率（audit_log 派生）", () => {
  it("只算人决定的 AI 提议，人工创建的不进分母", async () => {
    await aiProposalDecided({ targetType: "node", decision: "confirmed" });
    await aiProposalDecided({ targetType: "node", decision: "confirmed" });
    await aiProposalDecided({ targetType: "node", decision: "rejected" });
    // 人工创建（proposer=human）——EXISTS(AI proposed) 不成立，应被排除。
    await aiProposalDecided({
      targetType: "node",
      decision: "confirmed",
      proposer: "human",
    });

    const m = await captureAcceptRate();
    expect(m.numerator).toBe(2); // accepted
    expect(m.denominator).toBe(3); // 2 confirmed + 1 rejected（human 那条不算）
    expect(m.value).toBeCloseTo(2 / 3, 5);
  });

  it("无样本时 value 为 null（面板显示 N/A，不是 0）", async () => {
    const m = await captureAcceptRate();
    expect(m.value).toBeNull();
    expect(m.denominator).toBe(0);
  });
});

describe("rollup：高风险边错连率（audit_log 派生）", () => {
  it("只统计高风险边，被拒 / 已决定", async () => {
    // 高风险边：because（拒）、supports（确认）、validates（拒）
    await aiProposalDecided({
      targetType: "edge",
      decision: "rejected",
      edgeType: "because",
    });
    await aiProposalDecided({
      targetType: "edge",
      decision: "confirmed",
      edgeType: "supports",
    });
    await aiProposalDecided({
      targetType: "edge",
      decision: "rejected",
      edgeType: "validates",
    });
    // 低风险边 blocks——不应计入高风险分母。
    await aiProposalDecided({
      targetType: "edge",
      decision: "rejected",
      edgeType: "blocks",
    });

    const m = await highRiskMiswireRate();
    expect(m.numerator).toBe(2); // 2 高风险被拒
    expect(m.denominator).toBe(3); // 3 高风险已决定（blocks 不算）
    expect(m.value).toBeCloseTo(2 / 3, 5);
  });

  it("被拒边的 rejected 行 edge_type=NULL 也要算进去（Phase3 首审暴露的回归）", async () => {
    // 复现真实历史数据：早期 rejectEdge 漏记 edgeType，导致 rejected 审计行
    // edge_type=NULL。高风险判定必须靠 proposed 行（永远有 edge_type），否则
    // 这条被拒边被漏掉、错连率被低估为 0。
    const targetId = randomUUID();
    await db.insert(auditLog).values([
      {
        targetType: "edge",
        targetId,
        action: "proposed",
        actor: "import",
        edgeType: "because", // proposed 行有类型
      },
      {
        targetType: "edge",
        targetId,
        action: "rejected",
        actor: "human",
        edgeType: null as never, // 老 bug：rejected 行 edge_type 为空
      },
    ]);
    const m = await highRiskMiswireRate();
    expect(m.numerator).toBe(1); // 这条被拒边被正确计入
    expect(m.denominator).toBe(1);
    expect(m.value).toBeCloseTo(1, 5);
  });
});

describe("rollup：events 派生的三条", () => {
  beforeEach(async () => {
    await db.insert(events).values([
      { kind: "retrieval", payload: { outcome: "answer" }, projectId: TEST_PROJECT },
      { kind: "retrieval", payload: { outcome: "answer" }, projectId: TEST_PROJECT },
      { kind: "retrieval", payload: { outcome: "no_record" }, projectId: TEST_PROJECT },
      { kind: "retrieval", payload: { outcome: "error" }, projectId: TEST_PROJECT },
      { kind: "citation_click", payload: { nodeId: "x" }, projectId: TEST_PROJECT },
      { kind: "citation_click", payload: { nodeId: "y" }, projectId: TEST_PROJECT },
      { kind: "citation_click", payload: { nodeId: "z" }, projectId: TEST_PROJECT },
      { kind: "approval_session", payload: { durationMs: 60000 }, projectId: TEST_PROJECT },
      { kind: "approval_session", payload: { durationMs: 120000 }, projectId: TEST_PROJECT },
    ]);
  });

  it("拒答占比 = no_record / 全部 retrieval", async () => {
    const m = await noRecordRate();
    expect(m.numerator).toBe(1);
    expect(m.denominator).toBe(4);
    expect(m.value).toBeCloseTo(0.25, 5);
  });

  it("引用点击率 = 点击数 / 成功答出数（可 >100%）", async () => {
    const m = await citationClickRate();
    expect(m.numerator).toBe(3); // clicks
    expect(m.denominator).toBe(2); // answers
    expect(m.value).toBeCloseTo(1.5, 5);
  });

  it("平均审批耗时 = durationMs 均值，denominator = 会话数", async () => {
    const m = await avgApprovalDurationMs();
    expect(m.value).toBeCloseTo(90000, 5);
    expect(m.denominator).toBe(2);
  });

  it("since 窗口过滤：只统计窗口内的事件（防 Date 绑定回归）", async () => {
    // 上面 beforeEach 已插 4 条 retrieval（at=now）。再插一条"两周前"的 no_record，
    // 用近 7 天窗口应把它排除——同时验证 since 参数真能传进 SQL 不报错。
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    await db.insert(events).values({
      kind: "retrieval",
      payload: { outcome: "no_record" },
      projectId: TEST_PROJECT,
      at: twoWeeksAgo,
    });
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const windowed = await noRecordRate(since);
    expect(windowed.denominator).toBe(4); // 窗口外那条不算
    const allTime = await noRecordRate();
    expect(allTime.denominator).toBe(5); // 全时段含窗口外那条
  });
});
