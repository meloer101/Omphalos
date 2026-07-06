import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { nodes, edges, provenance, auditLog } from "@/db/schema";
import { edgeRiskOf, type BoardStatus, type EdgeType, type NodeType } from "@/db/enums";
import type { Node, Edge, Provenance } from "@/db/schema";
import { getBoss, QUEUE } from "@/lib/queue/boss";

/**
 * 节点正文变化后，异步补一份向量（Phase2-开工计划.md 2.1）。故意做成
 * "尽力而为、失败不影响写入"：向量只是检索索引，队列暂时不可用时不能
 * 连累图写入本身——下次编辑正文会再次入队补上。只在正文可能变化的地方
 * 调用（建节点、编辑正文），confirmNode 不改正文所以不重复向量化。
 */
async function enqueueEmbed(nodeId: string): Promise<void> {
  try {
    const boss = await getBoss();
    await boss.send(QUEUE.embed, { nodeId });
  } catch (err) {
    console.error(`[embed] 入队失败（不影响写入）node ${nodeId}:`, err);
  }
}

/**
 * 新提议落库后通知审批 tab 实时刷新（Phase1-开工计划.md 1.0，架构 5.3）。
 * 特意在事务内调用：Postgres 的 NOTIFY 只在事务提交后才真正投递，写在
 * 事务里等价于"提交成功才通知"，回滚的写入不会误触前端刷新。这个频道
 * 只服务 SSE 实时推送这一件事，不承载 Agent 间编排（决策 A）。
 */
async function notifyGraphChange(
  tx: Pick<typeof db, "execute">,
  payload: { kind: "node" | "edge"; id: string; type: string; projectId: string },
): Promise<void> {
  await tx.execute(
    sql`select pg_notify('graph_proposals', ${JSON.stringify(payload)})`,
  );
}

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
  const node = await db.transaction(async (tx) => {
    const [row] = await tx
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
      nodeId: row.id,
      sourceRef: input.sourceRef,
      createdBy: input.createdBy,
      confidence: input.confidence ?? null,
    });

    await tx.insert(auditLog).values({
      targetType: "node",
      targetId: row.id,
      action: row.status === "confirmed" ? "confirmed" : "proposed",
      actor: input.createdBy,
    });

    if (row.status === "proposed") {
      await notifyGraphChange(tx, {
        kind: "node",
        id: row.id,
        type: row.type,
        projectId: row.projectId,
      });
    }

    return row;
  });

  // 提交成功后再补索引（send 不进业务事务：即便回滚，孤儿 embed job 也
  // 只是查不到节点后安静跳过）。语义检索只认 confirmed 节点，所以 proposed
  // 节点的向量先算着存起来，审批通过即可立即被搜到（Phase2-开工计划.md 2.1）。
  await enqueueEmbed(node.id);

  return node;
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

    if (edge.status === "proposed") {
      await notifyGraphChange(tx, {
        kind: "edge",
        id: edge.id,
        type: edge.type,
        projectId: edge.projectId,
      });
    }

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

/**
 * 撤销一条已自动生效的低风险边（Phase1-开工计划.md 决策 C："低风险边
 * 写入即 confirmed + 可撤销"）。镜像 rejectEdge：直接删除+留 audit，
 * action 记 'reverted' 而非 'rejected'——语义上这条边曾经真的生效过，
 * 不是被挡在门外的提议。
 *
 * 只对低风险边开放：高风险边一旦确认就是信任账本，DB 的
 * `guard_confirmed_edges` 触发器会物理拒绝删除（见 db/migrations/
 * 0004_low_risk_edges_revocable.sql）。这里先查一次 risk 给出更友好的
 * 错误信息，而不是让调用方直接吃裸的 Postgres 异常。
 */
export async function revertEdge(edgeId: string, actor: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [edge] = await tx.select().from(edges).where(eq(edges.id, edgeId));
    if (!edge) {
      throw new Error(`edge ${edgeId} not found`);
    }
    if (edge.risk === "high") {
      throw new Error(
        `edge ${edgeId} 是高风险边，已确认后不可撤销——它是信任账本的一部分`,
      );
    }

    await tx.insert(auditLog).values({
      targetType: "edge",
      targetId: edgeId,
      action: "reverted",
      actor,
      edgeType: edge.type,
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

export interface ReviewNodeItem {
  kind: "node";
  node: Node;
  provenance: Provenance | undefined;
}

export interface ReviewEdgeItem {
  kind: "edge";
  edge: Edge;
  srcNode: Node | undefined;
  dstNode: Node | undefined;
  provenance: Provenance | undefined;
}

export type ReviewItem = ReviewNodeItem | ReviewEdgeItem;

export interface PendingReview {
  /** 必须人显式确认/拒绝才生效：提议中的节点 + 提议中的边。 */
  pending: ReviewItem[];
  /** 已自动生效、可撤销：低风险且已确认的边（决策 C）。 */
  revocable: ReviewEdgeItem[];
}

/**
 * 审批 tab 的数据源（Phase1-开工计划.md 1.3）。按 project 过滤，不做
 * 分页——P1 规模够用，翻页是以后的事。分组（按天/按批次）是纯展示逻辑，
 * 交给调用方（app/review 的分组函数），这里只负责把待处理的东西查全。
 */
export async function listPendingReview(projectId: string): Promise<PendingReview> {
  const [proposedNodes, proposedEdgeRows, revocableEdgeRows] = await Promise.all([
    db
      .select()
      .from(nodes)
      .where(and(eq(nodes.projectId, projectId), eq(nodes.status, "proposed"))),
    db
      .select()
      .from(edges)
      .where(and(eq(edges.projectId, projectId), eq(edges.status, "proposed"))),
    db
      .select()
      .from(edges)
      .where(
        and(
          eq(edges.projectId, projectId),
          eq(edges.status, "confirmed"),
          eq(edges.risk, "low"),
        ),
      ),
  ]);

  const edgeRows = [...proposedEdgeRows, ...revocableEdgeRows];
  const relatedNodeIds = [...new Set(edgeRows.flatMap((e) => [e.srcId, e.dstId]))];
  const nodeProvenanceTargets = [...new Set(proposedNodes.map((n) => n.id))];
  const edgeIds = edgeRows.map((e) => e.id);

  const [relatedNodes, nodeProvenanceRows, edgeProvenanceRows] = await Promise.all([
    relatedNodeIds.length > 0
      ? db.select().from(nodes).where(inArray(nodes.id, relatedNodeIds))
      : Promise.resolve([]),
    nodeProvenanceTargets.length > 0
      ? db.select().from(provenance).where(inArray(provenance.nodeId, nodeProvenanceTargets))
      : Promise.resolve([]),
    edgeIds.length > 0
      ? db.select().from(provenance).where(inArray(provenance.edgeId, edgeIds))
      : Promise.resolve([]),
  ]);

  const nodeById = new Map(relatedNodes.map((n) => [n.id, n]));
  const provenanceByNodeId = new Map(
    nodeProvenanceRows.filter((p) => p.nodeId).map((p) => [p.nodeId!, p]),
  );
  const provenanceByEdgeId = new Map(
    edgeProvenanceRows.filter((p) => p.edgeId).map((p) => [p.edgeId!, p]),
  );

  const toEdgeItem = (edge: Edge): ReviewEdgeItem => ({
    kind: "edge",
    edge,
    srcNode: nodeById.get(edge.srcId),
    dstNode: nodeById.get(edge.dstId),
    provenance: provenanceByEdgeId.get(edge.id),
  });

  const pending: ReviewItem[] = [
    ...proposedNodes.map(
      (node): ReviewNodeItem => ({
        kind: "node",
        node,
        provenance: provenanceByNodeId.get(node.id),
      }),
    ),
    ...proposedEdgeRows.map(toEdgeItem),
  ];

  return {
    pending,
    revocable: revocableEdgeRows.map(toEdgeItem),
  };
}

export type RoadmapStatus = "planned" | "in_progress" | "done";

export interface RoadmapFeature {
  node: Node;
  status: RoadmapStatus;
  taskCount: number;
}

/**
 * Roadmap 视图的数据源（Phase1-开工计划.md 1.5，从 P4 提前——纯视图层，
 * 低成本）。需求节点按创建时间排列；状态不是单独维护的字段，是从它的
 * `implements` 入边（谁在实现它）聚合出连接任务的看板状态推导出来的——
 * 跟"看板 = 任务节点按状态渲染"是同一个套路：视图只是已有数据的不同
 * 投影，不是新数据。
 */
export async function listRoadmapFeatures(projectId: string): Promise<RoadmapFeature[]> {
  const features = await listNodesByType(projectId, "feature");
  if (features.length === 0) return [];

  const featureIds = features.map((f) => f.id);
  const implementsEdges = await db
    .select()
    .from(edges)
    .where(and(inArray(edges.dstId, featureIds), eq(edges.type, "implements")));

  const taskIds = [...new Set(implementsEdges.map((e) => e.srcId))];
  const tasks =
    taskIds.length > 0
      ? await db.select().from(nodes).where(inArray(nodes.id, taskIds))
      : [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const tasksByFeature = new Map<string, Node[]>();
  for (const edge of implementsEdges) {
    const task = taskById.get(edge.srcId);
    if (!task) continue;
    const list = tasksByFeature.get(edge.dstId) ?? [];
    list.push(task);
    tasksByFeature.set(edge.dstId, list);
  }

  return features
    .map((feature): RoadmapFeature => {
      const linkedTasks = tasksByFeature.get(feature.id) ?? [];
      const status: RoadmapStatus =
        linkedTasks.length === 0 || linkedTasks.every((t) => t.boardStatus === "todo")
          ? "planned"
          : linkedTasks.every((t) => t.boardStatus === "done")
            ? "done"
            : "in_progress";
      return { node: feature, status, taskCount: linkedTasks.length };
    })
    .sort((a, b) => a.node.createdAt.getTime() - b.node.createdAt.getTime());
}

/** 取单个节点，节点详情页（中央变形栏）的入口查询。 */
export async function getNode(nodeId: string): Promise<Node | undefined> {
  const [node] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
  return node;
}

/** 供"连边目标选择器"做搜索/下拉——同项目下的全部节点。 */
export async function listAllNodes(projectId: string): Promise<Node[]> {
  return db.select().from(nodes).where(eq(nodes.projectId, projectId));
}

export interface UpdateNodeInput {
  title?: string;
  body?: Record<string, unknown>;
  boardStatus?: BoardStatus;
}

/**
 * 编辑节点内容/看板状态。不写 audit_log——audit_log 的四个动作
 * （proposed/confirmed/rejected/reverted）本来就不含"编辑"，字段级
 * 编辑历史不在 Phase 0 范围内。`nodes_touch_updated_at` 触发器会
 * 自动戳 updated_at。DB 的 `nodes_guard` 触发器仍然保证：已确认
 * 节点的 type/project_id 不可变（title/body/boardStatus 仍可编辑）。
 */
export async function updateNode(
  nodeId: string,
  input: UpdateNodeInput,
): Promise<Node> {
  const [node] = await db
    .update(nodes)
    .set(input)
    .where(eq(nodes.id, nodeId))
    .returning();

  // 正文（title/body）变了才需要重算向量；只改 boardStatus（看板拖拽）不改
  // 语义内容，跳过省一次 embedding 调用（Phase2-开工计划.md 2.1）。
  if (input.title !== undefined || input.body !== undefined) {
    await enqueueEmbed(node.id);
  }

  return node;
}

/** 确认一个提议中的节点（镜像 confirmEdge）。 */
export async function confirmNode(nodeId: string, actor: string): Promise<Node> {
  return db.transaction(async (tx) => {
    const [node] = await tx
      .update(nodes)
      .set({ status: "confirmed" })
      .where(eq(nodes.id, nodeId))
      .returning();

    await tx.insert(auditLog).values({
      targetType: "node",
      targetId: node.id,
      action: "confirmed",
      actor,
    });

    return node;
  });
}

/**
 * 删除一个提议中的节点（镜像 rejectEdge：图无污染，历史留在
 * audit_log）。若节点已确认，DB 的 `nodes_guard` 触发器会拒绝并
 * 让整个事务（含 audit 插入）回滚——不会留下"删了但没删成"的
 * 脏审计记录。
 */
export async function deleteNode(nodeId: string, actor: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(auditLog).values({
      targetType: "node",
      targetId: nodeId,
      action: "rejected",
      actor,
    });
    await tx.delete(nodes).where(eq(nodes.id, nodeId));
  });
}
