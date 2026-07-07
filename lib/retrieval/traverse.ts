import { and, eq, inArray, or } from "drizzle-orm";
import { getDbReadonly } from "@/db/client";
import { nodes, edges } from "@/db/schema";
import { nodeEmbeddingText } from "@/lib/embed";
import type { EdgeType, NodeType } from "@/db/enums";

/**
 * 沿类型边精确行走（Phase2-开工计划.md 2.2，架构决策点 2 第 2 步）：从
 * 向量定位到的入口节点出发，沿边遍历出一片有界邻域。这一步是纯数据库
 * 查询，零幻觉——生成层只被允许引用这里走到的节点（见 answer.ts + cite.ts）。
 *
 * 两条铁律，与 search.ts 一致：
 *  1. 只读凭证 `getDbReadonly()`，本文件不 import 读写实例。
 *  2. **只走 `confirmed` 边**——proposed 高风险因果边在人确认前对追溯不可见
 *     （PRD R5 验收：追溯永不引用未确认因果边）。节点同样只纳入 confirmed。
 */

export interface ReachableNode {
  id: string;
  type: NodeType;
  title: string;
  /** 供生成层组织语言的正文摘要（title + body 拍平，截断防 prompt 爆）。 */
  excerpt: string;
}

export interface ReachableEdge {
  id: string;
  type: EdgeType;
  srcId: string;
  dstId: string;
}

export interface Subgraph {
  nodes: ReachableNode[];
  edges: ReachableEdge[];
}

const EXCERPT_MAX = 600;

function toExcerpt(node: { title: string; body: unknown }): string {
  const text = nodeEmbeddingText({
    title: node.title,
    body: (node.body ?? {}) as Record<string, unknown>,
  });
  return text.length > EXCERPT_MAX ? text.slice(0, EXCERPT_MAX) + "…" : text;
}

/**
 * 从入口节点 BFS 有界遍历（默认 2 跳）。返回可达的 confirmed 节点集合 +
 * 它们之间的 confirmed 边。空入口 → 空子图（answer.ts 据此走"图里没有记录"）。
 */
export async function traverseFromEntries(
  entryIds: string[],
  maxHops = 2,
): Promise<Subgraph> {
  if (entryIds.length === 0) return { nodes: [], edges: [] };
  const db = getDbReadonly();

  const reachableIds = new Set<string>(entryIds);
  const collectedEdges = new Map<string, ReachableEdge>();
  let frontier = [...entryIds];

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const hopEdges = await db
      .select({
        id: edges.id,
        type: edges.type,
        srcId: edges.srcId,
        dstId: edges.dstId,
      })
      .from(edges)
      .where(
        and(
          eq(edges.status, "confirmed"),
          or(inArray(edges.srcId, frontier), inArray(edges.dstId, frontier)),
        ),
      );

    const nextFrontier: string[] = [];
    for (const e of hopEdges) {
      collectedEdges.set(e.id, e);
      for (const nid of [e.srcId, e.dstId]) {
        if (!reachableIds.has(nid)) {
          reachableIds.add(nid);
          nextFrontier.push(nid);
        }
      }
    }
    frontier = nextFrontier;
  }

  // 只保留 confirmed 节点（入口来自 search.ts 已是 confirmed，但一跳邻居
  // 里可能混入 proposed 节点——它们不该进追溯的引用集合）。
  const nodeRows = await db
    .select({
      id: nodes.id,
      type: nodes.type,
      title: nodes.title,
      body: nodes.body,
      status: nodes.status,
    })
    .from(nodes)
    .where(
      and(
        inArray(nodes.id, [...reachableIds]),
        eq(nodes.status, "confirmed"),
      ),
    );

  const confirmedIds = new Set(nodeRows.map((n) => n.id));

  return {
    nodes: nodeRows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      excerpt: toExcerpt(n),
    })),
    // 丢弃任一端落在 proposed 节点上的边——引用集合必须自洽。
    edges: [...collectedEdges.values()].filter(
      (e) => confirmedIds.has(e.srcId) && confirmedIds.has(e.dstId),
    ),
  };
}
