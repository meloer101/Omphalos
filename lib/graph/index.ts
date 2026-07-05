import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { nodes, edges, provenance, auditLog } from "@/db/schema";
import { edgeRiskOf, type EdgeType, type NodeType } from "@/db/enums";
import type { Node, Edge } from "@/db/schema";

/**
 * 图操作核心（Agent架构设计.md R1）。这是唯一允许触碰 nodes/edges/
 * provenance/audit_log 四张表的地方——视图层和 Agent 只通过这里读写图，
 * 从不直接拼 SQL，保证出处/审计规则永远被遵守。
 */

export interface SourceRef {
  kind: "human" | "import" | "agent";
  detail: Record<string, unknown>;
}

export interface CreateNodeInput {
  type: NodeType;
  projectId: string;
  title: string;
  body?: Record<string, unknown>;
  status?: "proposed" | "confirmed";
  createdBy: string; // 'human' 或 agent 合同名
  sourceRef: SourceRef;
  confidence?: number;
}

/** 建节点，永远同时写一条出处记录（人工创建 confidence 为 null）。 */
export async function createNode(input: CreateNodeInput): Promise<Node> {
  return db.transaction(async (tx) => {
    const [node] = await tx
      .insert(nodes)
      .values({
        type: input.type,
        projectId: input.projectId,
        title: input.title,
        body: input.body ?? {},
        status: input.status ?? "proposed",
      })
      .returning();

    await tx.insert(provenance).values({
      nodeId: node.id,
      sourceRef: input.sourceRef,
      createdBy: input.createdBy,
      confidence: input.confidence ?? null,
    });

    await tx.insert(auditLog).values({
      targetType: "node",
      targetId: node.id,
      action: node.status === "confirmed" ? "confirmed" : "proposed",
      actor: input.createdBy,
    });

    return node;
  });
}

export interface CreateEdgeInput {
  type: EdgeType;
  srcId: string;
  dstId: string;
  projectId: string;
  status?: "proposed" | "confirmed";
  createdBy: string;
  sourceRef: SourceRef;
  confidence?: number;
}

/**
 * 连边——出处必须同事务写入（DB 的 deferred constraint trigger 在
 * 提交时会校验，这里在应用层同样保证，双保险）。risk 由 DB 触发器
 * 权威计算，这里仍显式传值以保持类型清晰。
 */
export async function createEdge(input: CreateEdgeInput): Promise<Edge> {
  return db.transaction(async (tx) => {
    const [edge] = await tx
      .insert(edges)
      .values({
        type: input.type,
        risk: edgeRiskOf(input.type),
        srcId: input.srcId,
        dstId: input.dstId,
        projectId: input.projectId,
        status: input.status ?? "proposed",
      })
      .returning();

    await tx.insert(provenance).values({
      edgeId: edge.id,
      sourceRef: input.sourceRef,
      createdBy: input.createdBy,
      confidence: input.confidence ?? null,
    });

    await tx.insert(auditLog).values({
      targetType: "edge",
      targetId: edge.id,
      action: edge.status === "confirmed" ? "confirmed" : "proposed",
      actor: input.createdBy,
      edgeType: edge.type,
    });

    return edge;
  });
}

/** 确认一条提议中的边（高风险边必须走这里，不允许绕过 UI 直接改状态）。 */
export async function confirmEdge(edgeId: string, actor: string): Promise<Edge> {
  return db.transaction(async (tx) => {
    const [edge] = await tx
      .update(edges)
      .set({ status: "confirmed" })
      .where(eq(edges.id, edgeId))
      .returning();

    await tx.insert(auditLog).values({
      targetType: "edge",
      targetId: edge.id,
      action: "confirmed",
      actor,
      edgeType: edge.type,
    });

    return edge;
  });
}

/** 拒绝一条提议中的边——直接删除（图无污染），历史留在 audit_log。 */
export async function rejectEdge(edgeId: string, actor: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(auditLog).values({
      targetType: "edge",
      targetId: edgeId,
      action: "rejected",
      actor,
    });
    await tx.delete(edges).where(eq(edges.id, edgeId));
  });
}

/** 查一个节点的直接邻域（一跳），用于装配 Agent 上下文和节点详情页。 */
export async function getNodeNeighborhood(nodeId: string) {
  const outgoing = await db
    .select()
    .from(edges)
    .where(eq(edges.srcId, nodeId));
  const incoming = await db
    .select()
    .from(edges)
    .where(eq(edges.dstId, nodeId));
  return { outgoing, incoming };
}

/** 查一条边或一个节点的完整出处链。 */
export async function getProvenance(target: { edgeId?: string; nodeId?: string }) {
  const condition = target.edgeId
    ? eq(provenance.edgeId, target.edgeId)
    : eq(provenance.nodeId, target.nodeId!);
  return db.select().from(provenance).where(condition);
}

export async function listNodesByType(projectId: string, type: NodeType) {
  return db
    .select()
    .from(nodes)
    .where(and(eq(nodes.projectId, projectId), eq(nodes.type, type)));
}
