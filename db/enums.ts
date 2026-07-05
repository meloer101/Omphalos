import { z } from "zod";

/**
 * Single source of truth for the graph kernel's closed enums.
 * db/schema.ts derives its pgEnum from these same arrays, so the
 * database constraint and the application-level validator can never drift.
 * See Agent架构设计.md 决策点 3（schema v1 已冻结为 8 种边）。
 */

export const NODE_TYPES = ["evidence", "feature", "task", "outcome"] as const;
export const nodeTypeSchema = z.enum(NODE_TYPES);
export type NodeType = z.infer<typeof nodeTypeSchema>;

export const EDGE_TYPES = [
  "supports", // 证据 -> 需求
  "implements", // 任务 -> 需求
  "validates", // 结果 -> 需求
  "refutes", // 结果 -> 需求
  "because", // 需求/决策 -> 证据或约束
  "supersedes", // 节点 -> 节点
  "duplicates", // 节点 -> 节点
  "blocks", // 任务 -> 任务
] as const;
export const edgeTypeSchema = z.enum(EDGE_TYPES);
export type EdgeType = z.infer<typeof edgeTypeSchema>;

export const EDGE_STATUS = ["proposed", "confirmed"] as const;
export const edgeStatusSchema = z.enum(EDGE_STATUS);
export type EdgeStatus = z.infer<typeof edgeStatusSchema>;

export const AUDIT_ACTIONS = [
  "proposed",
  "confirmed",
  "rejected",
  "reverted",
] as const;
export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof auditActionSchema>;

/**
 * 低风险边自动生效可撤销；高风险边（将来会被当事实查的边）必须人显式确认。
 * 见 Agent架构设计.md 决策点 9。
 */
export const HIGH_RISK_EDGE_TYPES: readonly EdgeType[] = [
  "supports",
  "because",
  "validates",
  "refutes",
];

export function edgeRiskOf(type: EdgeType): "high" | "low" {
  return HIGH_RISK_EDGE_TYPES.includes(type) ? "high" : "low";
}
