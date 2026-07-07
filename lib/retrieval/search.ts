import { and, cosineDistance, desc, eq, gt, ne, sql } from "drizzle-orm";
import { getDbReadonly } from "@/db/client";
import { nodes } from "@/db/schema";
import { embed } from "ai";
import { getEmbeddingModel } from "@/lib/ai/client";

/**
 * 语义定位（Phase2-开工计划.md 2.1，架构决策点 2 第 1 步）：向量搜索找
 * 追溯问答的入口节点。
 *
 * 两条铁律：
 *  1. **只走只读凭证** `getDbReadonly()`——检索合同物理只读（架构 5.2，
 *     安全靠构造不靠模型自觉）。本文件永远不 import `db`（读写实例）。
 *  2. **只认 confirmed 节点**——proposed 是还没被人接纳的提议，追溯不该
 *     引用未经审批的内容（与 traverse 只走 confirmed 边同理）。
 */

export interface SearchHit {
  id: string;
  type: string;
  title: string;
  /** cosine 相似度 [0,1]，越大越像。 */
  similarity: number;
  /** 命中来源项目：与查询项目一致为 'local'，升级到全局命中为 'global'。 */
  scope: "local" | "global";
}

export interface SemanticSearchOptions {
  limit?: number;
  /** 相似度下限，低于它的命中丢弃（默认 0.3，宁缺毋滥堵幻觉入口）。 */
  minSimilarity?: number;
}

/**
 * 升级式检索（架构 5.1）：先在当前 project 局部找；局部无果才升级查全局，
 * 并把命中标注为 'global'（"本项目没有，但 B 项目去年有相关结论"是砌墙
 * 方案永远给不了的时刻）。
 */
export async function semanticSearch(
  projectId: string,
  queryEmbedding: number[],
  options: SemanticSearchOptions = {},
): Promise<SearchHit[]> {
  const limit = options.limit ?? 8;
  const minSimilarity = options.minSimilarity ?? 0.3;
  const db = getDbReadonly();

  const similarity = sql<number>`1 - (${cosineDistance(nodes.embedding, queryEmbedding)})`;

  // 局部：当前 project 的 confirmed 节点，按相似度降序。
  const local = await db
    .select({
      id: nodes.id,
      type: nodes.type,
      title: nodes.title,
      similarity,
    })
    .from(nodes)
    .where(
      and(
        eq(nodes.projectId, projectId),
        eq(nodes.status, "confirmed"),
        gt(similarity, minSimilarity),
      ),
    )
    .orderBy(desc(similarity))
    .limit(limit);

  if (local.length > 0) {
    return local.map((r) => ({ ...r, scope: "local" as const }));
  }

  // 升级：局部一条都没有，查其它 project 的 confirmed 节点。
  const global = await db
    .select({
      id: nodes.id,
      type: nodes.type,
      title: nodes.title,
      similarity,
    })
    .from(nodes)
    .where(
      and(
        ne(nodes.projectId, projectId),
        eq(nodes.status, "confirmed"),
        gt(similarity, minSimilarity),
      ),
    )
    .orderBy(desc(similarity))
    .limit(limit);

  return global.map((r) => ({ ...r, scope: "global" as const }));
}

/** 把自然语言问题向量化，供 semanticSearch。抽出来是为了 answer.ts 复用。 */
export async function embedQuery(question: string): Promise<number[]> {
  const { embedding } = await embed({
    model: getEmbeddingModel(),
    value: question,
  });
  return embedding;
}
