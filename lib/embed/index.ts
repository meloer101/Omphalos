import { eq, inArray } from "drizzle-orm";
import { embed, embedMany } from "ai";
import { db } from "@/db/client";
import { nodes } from "@/db/schema";
import { getEmbeddingModel } from "@/lib/ai/client";
import type { Node } from "@/db/schema";

/**
 * 语义索引的文本抽取 + 向量化（Phase2-开工计划.md 2.1）。
 *
 * 职责边界：本模块**写回** `nodes.embedding`，但 embedding 是从节点正文
 * 派生出来的元数据（同 `updated_at`），不是信任账本的一部分——所以它
 * 走直连 UPDATE，不经 lib/graph 的出处/审计事务，也不进 audit_log。
 * 这跟"边和确认记录 append-only"不冲突：向量随正文变化被覆盖是正常的，
 * 覆盖它不会丢失任何"当初为什么"的事实（事实在 title/body 里，向量只是
 * 它们的检索索引）。
 */

/** BlockNote 的行内内容：可能是 {type:'text', text} 数组，也可能直接是字符串。 */
function extractInlineText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "text" in item) {
        return String((item as { text: unknown }).text ?? "");
      }
      return "";
    })
    .join("");
}

/** 递归抽取 BlockNote 块（含 children）的纯文本。 */
function extractBlocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const b = block as { content?: unknown; children?: unknown };
      const own = extractInlineText(b.content);
      const nested = extractBlocksText(b.children);
      return [own, nested].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * 把一个节点的 title + JSONB body 拍平成一段纯文本，供 embedding。
 * 处理三种 body 形状（见 db/schema.ts 注释）：
 *  - evidence: { text }
 *  - feature/task: { blocks: BlockNote[] }（feature 还带 prototypes，跳过图片）
 *  - outcome: { metric, value, note }
 * 拿不准的形状退化为空——宁可只用 title，也不把结构化 JSON 原样塞进去污染向量。
 */
export function nodeEmbeddingText(node: Pick<Node, "title" | "body">): string {
  const body = (node.body ?? {}) as Record<string, unknown>;
  const parts: string[] = [node.title];

  if (typeof body.text === "string") {
    parts.push(body.text);
  }
  if (Array.isArray(body.blocks)) {
    const blocksText = extractBlocksText(body.blocks);
    if (blocksText) parts.push(blocksText);
  }
  // outcome 节点：指标名 + 值 + 备注
  for (const key of ["metric", "value", "note"] as const) {
    if (typeof body[key] === "string" && body[key]) {
      parts.push(String(body[key]));
    }
  }

  return parts.filter(Boolean).join("\n").trim();
}

/**
 * 生成单个节点的向量并写回。取节点 → 拼文本 → embed → UPDATE。
 * 节点不存在（导入/删除竞态）或正文为空时安静跳过——不是错误，
 * 只是没有可索引的内容。
 */
export async function embedNode(nodeId: string): Promise<void> {
  const [node] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
  if (!node) return;

  const text = nodeEmbeddingText(node);
  if (!text) return;

  const { embedding } = await embed({
    model: getEmbeddingModel(),
    value: text,
  });

  await db.update(nodes).set({ embedding }).where(eq(nodes.id, nodeId));
}

/**
 * 批量向量化（导入冷启动 5000 条级别时省往返；embedMany 内部按 provider
 * 上限自动分批）。跳过取不到或正文为空的节点，只写回真正算出向量的。
 */
export async function embedNodes(nodeIds: string[]): Promise<void> {
  if (nodeIds.length === 0) return;

  const rows = await db.select().from(nodes).where(inArray(nodes.id, nodeIds));
  const byId = new Map(rows.map((n) => [n.id, n]));

  const targets: { id: string; text: string }[] = [];
  for (const id of nodeIds) {
    const node = byId.get(id);
    if (!node) continue;
    const text = nodeEmbeddingText(node);
    if (text) targets.push({ id, text });
  }
  if (targets.length === 0) return;

  const { embeddings } = await embedMany({
    model: getEmbeddingModel(),
    values: targets.map((t) => t.text),
  });

  await db.transaction(async (tx) => {
    for (let i = 0; i < targets.length; i++) {
      await tx
        .update(nodes)
        .set({ embedding: embeddings[i] })
        .where(eq(nodes.id, targets[i].id));
    }
  });
}
