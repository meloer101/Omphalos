-- Phase3-开工计划.md 决策 K/L：dogfooding Leading 指标的埋点事件表。
-- 刻意扁平——kind 区分事件种类，payload 放各自的字段（jsonb），聚合查询
-- 在 lib/metrics/rollup.ts 里写。三条现在没采集的交互指标才落这里：
--   retrieval        每次追溯问答（outcome: answer|no_record|error）→ 拒答占比
--   citation_click   Cmd-K 答案里的行内蓝链被点 → 引用点击率
--   approval_session 审批 tab 一次批阅的停留时长 → 日均审批耗时
-- （捕获接受率、高风险边错连率两条从 audit_log 派生，不进本表——决策 L。）
--
-- 事件天然只 append，不做禁 UPDATE/DELETE 触发器（决策 L）。只读角色
-- graph_readonly 靠迁移 0003 的默认权限自动获得 SELECT。
CREATE TABLE IF NOT EXISTS "events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "project_id" uuid NOT NULL,
  "at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

-- rollup 按 kind + 时间窗口聚合，这个复合索引覆盖典型查询。
CREATE INDEX IF NOT EXISTS "events_kind_at_idx" ON "events" ("kind", "at");
