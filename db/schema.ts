import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  vector,
  real,
  timestamp,
} from "drizzle-orm/pg-core";
import {
  NODE_TYPES,
  EDGE_TYPES,
  EDGE_STATUS,
  AUDIT_ACTIONS,
  BOARD_STATUSES,
} from "./enums";

// Enums derived from the single source of truth (db/enums.ts) — never
// hand-edit these arrays here, edit db/enums.ts and regenerate.
export const nodeTypeEnum = pgEnum("node_type", NODE_TYPES);
export const edgeTypeEnum = pgEnum("edge_type", EDGE_TYPES);
export const edgeRiskEnum = pgEnum("edge_risk", ["high", "low"]);
export const statusEnum = pgEnum("status", EDGE_STATUS);
export const auditActionEnum = pgEnum("audit_action", AUDIT_ACTIONS);
export const boardStatusEnum = pgEnum("board_status", BOARD_STATUSES);

/**
 * 四类节点：证据 / 需求 / 任务 / 结果。project_id 是逻辑 scope 字段
 * （物理不分库，见 Agent架构设计.md "project 分割"）。
 * embedding 维度暂定 1536（待 D3 确定 embedding 模型后可能调整，
 * Phase 0 不填充，P2 语义检索才使用）。
 */
export const nodes = pgTable("nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: nodeTypeEnum("type").notNull(),
  projectId: uuid("project_id").notNull(),
  title: text("title").notNull(),
  body: jsonb("body").notNull().default({}),
  status: statusEnum("status").notNull().default("proposed"),
  // 仅 task 类型节点使用；其他类型忽略这个字段。与上面的 status
  // （信任账本轴）是两件完全不同的事，不要混用。
  boardStatus: boardStatusEnum("board_status").notNull().default("todo"),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 边表：type 走封闭枚举（DB check 约束会在迁移中额外加固），
 * risk 由 db/enums.ts 的 edgeRiskOf() 在写入时计算并落库
 * （高风险边须人显式确认，见架构决策点 9）。
 */
export const edges = pgTable("edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: edgeTypeEnum("type").notNull(),
  risk: edgeRiskEnum("risk").notNull(),
  srcId: uuid("src_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  dstId: uuid("dst_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull(),
  status: statusEnum("status").notNull().default("proposed"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 出处表：每条边、每个 AI 写入的节点都必须能查到出处。
 * 无出处的边写入被拒——这条约束在迁移中用触发器加固，
 * 不只靠应用层校验（见架构决策点 3/8）。
 */
export const provenance = pgTable("provenance", {
  id: uuid("id").primaryKey().defaultRandom(),
  edgeId: uuid("edge_id").references(() => edges.id, { onDelete: "cascade" }),
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "cascade" }),
  sourceRef: jsonb("source_ref").notNull(),
  createdBy: text("created_by").notNull(), // 'human' 或 agent 合同名，如 'capture-agent'
  confidence: real("confidence"), // AI 置信度；人工创建为 null
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 确认记录：append-only（迁移中的触发器禁止 UPDATE/DELETE）。
 * edgeType 冗余存储，便于按边类型统计接受率（P1 放权的原料）。
 */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  targetType: text("target_type").notNull(), // 'node' | 'edge'
  targetId: uuid("target_id").notNull(),
  action: auditActionEnum("action").notNull(),
  actor: text("actor").notNull(),
  edgeType: edgeTypeEnum("edge_type"), // 仅 target_type = 'edge' 时填充
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export type Node = typeof nodes.$inferSelect;
export type NewNode = typeof nodes.$inferInsert;
export type Edge = typeof edges.$inferSelect;
export type NewEdge = typeof edges.$inferInsert;
export type Provenance = typeof provenance.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
