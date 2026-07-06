import type { ReviewItem } from "@/lib/graph";

/**
 * 审批 tab 的分组逻辑（Phase1-开工计划.md 1.3："按天/按批次分组"）。
 * 纯函数，不碰数据库——数据全查好之后交给这里分组、渲染时用。
 *
 * 批次键来自 `sourceRef.detail.batchId`（worker/index.ts 用 pg-boss 的
 * job.id 填充，见 lib/agents/contracts/capture.ts）。没有 batchId 的
 * 项目（人工创建，或还没跑过 capture 的历史数据）各自单独成组，
 * 不会被错误地拼进同一批。
 */

export interface ReviewGroup {
  key: string;
  day: string; // YYYY-MM-DD
  batchId?: string;
  channel?: string;
  items: ReviewItem[];
}

function itemCreatedAt(item: ReviewItem): Date {
  return item.kind === "node" ? item.node.createdAt : item.edge.createdAt;
}

function itemId(item: ReviewItem): string {
  return item.kind === "node" ? item.node.id : item.edge.id;
}

function extractCaptureMeta(sourceRef: unknown): {
  batchId?: string;
  channel?: string;
} {
  if (typeof sourceRef !== "object" || sourceRef === null) return {};
  const detail = (sourceRef as { detail?: unknown }).detail;
  if (typeof detail !== "object" || detail === null) return {};
  const d = detail as Record<string, unknown>;
  return {
    batchId: typeof d.batchId === "string" ? d.batchId : undefined,
    channel: typeof d.channel === "string" ? d.channel : undefined,
  };
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function groupReviewItems(items: ReviewItem[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>();

  for (const item of items) {
    const createdAt = itemCreatedAt(item);
    const day = dayKey(createdAt);
    const { batchId, channel } = extractCaptureMeta(item.provenance?.sourceRef);
    const key = batchId ? `${day}::batch::${batchId}` : `${day}::single::${itemId(item)}`;

    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, { key, day, batchId, channel, items: [item] });
    }
  }

  // 新的在前：组间按组内最新时间排序，方便"刚捕获的批次"排在最上面。
  return [...groups.values()].sort((a, b) => {
    const aTime = Math.max(...a.items.map((i) => itemCreatedAt(i).getTime()));
    const bTime = Math.max(...b.items.map((i) => itemCreatedAt(i).getTime()));
    return bTime - aTime;
  });
}
