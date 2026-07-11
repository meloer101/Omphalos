import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { HIGH_RISK_EDGE_TYPES } from "@/db/enums";

/**
 * Phase3-开工计划.md 3.2：五条 dogfooding Leading 指标的聚合（决策 L）。
 * 两条查 audit_log（派生，无新埋点），三条查 events（3.1 埋的）。全是纯 SQL，
 * 是 Go/No-Go 的裁判——所以有专门的单测（rollup.test.ts）连真库断言算得对。
 *
 * audit_log 语义（lib/graph 写入）：
 *  - AI 提议 = action='proposed' 且 actor<>'human'（actor 是合同名，如 capture/import）
 *  - 人的决定 = action in (confirmed,rejected) 且 actor='human'
 *  - 低风险边自动生效时直接写 confirmed（跳过 proposed），因此天然不进"人决定的提议"分母
 *
 * 每个函数接受可选 `since`（只统计该时刻之后的事件/决定）；不传=全时段。
 */

/** 每条指标的统一返回形状：value 是率/均值（无样本时 null），带上原始计数便于面板显示。 */
export type Metric = {
  value: number | null;
  numerator: number;
  denominator: number;
};

function sinceClause(column: string, since?: Date) {
  // 传 ISO 字符串而非 Date 对象：postgres-js 的参数绑定不吃裸 Date，
  // 交给 Postgres 把字符串 cast 成 timestamptz。
  return since ? sql`AND ${sql.raw(column)} >= ${since.toISOString()}` : sql``;
}

/** 捕获接受率 = 人确认的 AI 提议 / 人决定（确认+拒绝）的 AI 提议。目标 ≥70%。 */
export async function captureAcceptRate(since?: Date): Promise<Metric> {
  const rows = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE al.action = 'confirmed')::int AS accepted,
      count(*) FILTER (WHERE al.action = 'rejected')::int  AS rejected
    FROM audit_log al
    WHERE al.action IN ('confirmed','rejected')
      AND al.actor = 'human'
      AND EXISTS (
        SELECT 1 FROM audit_log p
        WHERE p.target_id = al.target_id
          AND p.action = 'proposed'
          AND p.actor <> 'human'
      )
      ${sinceClause("al.at", since)}
  `)) as unknown as Array<{ accepted: number; rejected: number }>;
  const { accepted, rejected } = rows[0] ?? { accepted: 0, rejected: 0 };
  const denominator = accepted + rejected;
  return {
    value: denominator === 0 ? null : accepted / denominator,
    numerator: accepted,
    denominator,
  };
}

/**
 * 高风险边错连率 = 被人拒绝的高风险边 / 人决定的高风险 AI 提议边。目标 <5%。
 *
 * "是否高风险"从 **proposed 行**的 edge_type 判定，而不是决定行——因为被拒边
 * 删除前记的那条 rejected 审计行历史上可能 edge_type=NULL（rejectEdge 早期
 * 漏记，Phase3 首审暴露并已修）。proposed 行的 edge_type 永远可靠。
 */
export async function highRiskMiswireRate(since?: Date): Promise<Metric> {
  const highRiskList = sql.join(
    HIGH_RISK_EDGE_TYPES.map((t) => sql`${t}`),
    sql`, `,
  );
  const rows = (await db.execute(sql`
    WITH ai_high_risk AS (
      SELECT DISTINCT target_id
      FROM audit_log
      WHERE target_type = 'edge'
        AND action = 'proposed'
        AND actor <> 'human'
        AND edge_type IN (${highRiskList})
    )
    SELECT
      count(*) FILTER (WHERE d.action = 'rejected')::int AS rejected,
      count(*)::int AS decided
    FROM ai_high_risk e
    JOIN audit_log d ON d.target_id = e.target_id
      AND d.action IN ('confirmed','rejected')
      AND d.actor = 'human'
      ${sinceClause("d.at", since)}
  `)) as unknown as Array<{ rejected: number; decided: number }>;
  const { rejected, decided } = rows[0] ?? { rejected: 0, decided: 0 };
  return {
    value: decided === 0 ? null : rejected / decided,
    numerator: rejected,
    denominator: decided,
  };
}

/** 拒答占比 = "图里没有记录" / 全部追溯问答。随图变满应下降（无硬门槛）。 */
export async function noRecordRate(since?: Date): Promise<Metric> {
  const rows = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE payload->>'outcome' = 'no_record')::int AS no_record,
      count(*)::int AS total
    FROM events
    WHERE kind = 'retrieval'
      ${sinceClause("at", since)}
  `)) as unknown as Array<{ no_record: number; total: number }>;
  const { no_record, total } = rows[0] ?? { no_record: 0, total: 0 };
  return {
    value: total === 0 ? null : no_record / total,
    numerator: no_record,
    denominator: total,
  };
}

/** 引用点击率 = 行内蓝链点击数 / 成功答出的追溯数。目标 ≥30%（可 >100%，一答多点）。 */
export async function citationClickRate(since?: Date): Promise<Metric> {
  const rows = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM events
        WHERE kind = 'citation_click' ${sinceClause("at", since)})::int AS clicks,
      (SELECT count(*) FROM events
        WHERE kind = 'retrieval' AND payload->>'outcome' = 'answer'
          ${sinceClause("at", since)})::int AS answers
  `)) as unknown as Array<{ clicks: number; answers: number }>;
  const { clicks, answers } = rows[0] ?? { clicks: 0, answers: 0 };
  return {
    value: answers === 0 ? null : clicks / answers,
    numerator: clicks,
    denominator: answers,
  };
}

/** 日均审批耗时（毫秒均值）。目标 <5 分钟。denominator = 会话数。 */
export async function avgApprovalDurationMs(since?: Date): Promise<Metric> {
  const rows = (await db.execute(sql`
    SELECT
      avg((payload->>'durationMs')::numeric) AS avg_ms,
      count(*)::int AS sessions
    FROM events
    WHERE kind = 'approval_session'
      ${sinceClause("at", since)}
  `)) as unknown as Array<{ avg_ms: string | null; sessions: number }>;
  const { avg_ms, sessions } = rows[0] ?? { avg_ms: null, sessions: 0 };
  return {
    value: avg_ms === null ? null : Number(avg_ms),
    numerator: avg_ms === null ? 0 : Math.round(Number(avg_ms)),
    denominator: sessions,
  };
}

/**
 * 追溯查询数（窗口内 retrieval 事件总数）。P3 出口硬门槛之一：周追溯 ≥10 次。
 * 是个计数不是率，单独一个函数。
 */
export async function retrievalCount(since?: Date): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT count(*)::int AS n
    FROM events
    WHERE kind = 'retrieval'
      ${sinceClause("at", since)}
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/** 面板一次性取齐所有指标（本周 + 全时段两个窗口由调用方决定 since）。 */
export async function allMetrics(since?: Date) {
  const [acceptRate, miswireRate, noRecord, clickRate, approvalMs, retrievals] =
    await Promise.all([
      captureAcceptRate(since),
      highRiskMiswireRate(since),
      noRecordRate(since),
      citationClickRate(since),
      avgApprovalDurationMs(since),
      retrievalCount(since),
    ]);
  return { acceptRate, miswireRate, noRecord, clickRate, approvalMs, retrievals };
}
