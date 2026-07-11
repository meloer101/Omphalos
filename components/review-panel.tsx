import Link from "next/link";
import type { PendingReview, ReviewItem, ReviewEdgeItem } from "@/lib/graph";
import { NODE_TYPE_LABELS, EDGE_TYPE_LABELS } from "@/lib/labels";
import { groupReviewItems } from "@/app/review/group";
import { ApprovalTimer } from "@/components/approval-timer";
import {
  acceptNode,
  rejectNode,
  acceptEdge,
  rejectPendingEdge,
  revertConfirmedEdge,
  acceptBatch,
  rejectBatch,
} from "@/app/review/actions";

const CHANNEL_LABELS: Record<string, string> = {
  paste: "粘贴文本",
  file: "文件上传",
  "inbound-email": "邮件转发",
};

const buttonClass =
  "text-xs px-2 py-0.5 rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5";

/**
 * 审批的核心渲染逻辑（Phase1-开工计划.md 1.3/1.4）——被两处复用，同一套
 * 代码，不是两份实现：独立页面 `/review`（宽屏，适合一次批完大量积压）
 * 和侧边栏审批 tab（窄屏，适合日常顺手清一两条）。数据获取
 * （listPendingReview）和 Server Actions 都在别处，这里只管渲染。
 *
 * 两个区块：
 * - 待确认：提议中的节点/边，必须显式接受/拒绝才生效（按天/按捕获
 *   批次分组，批次内可整批操作，也可单条操作）
 * - 已自动生效（可撤销）：低风险边（决策 C），随时可以撤销
 */
export function ReviewPanel({ review }: { review: PendingReview }) {
  const { pending, revocable } = review;
  const pendingGroups = groupReviewItems(pending);
  const pendingRows = pendingGroups.map((group, idx) => ({
    group,
    showDayHeader: idx === 0 || pendingGroups[idx - 1].day !== group.day,
    nodeIds: group.items.filter((i) => i.kind === "node").map((i) => i.node.id),
    edgeIds: group.items.filter((i) => i.kind === "edge").map((i) => i.edge.id),
  }));

  return (
    <div className="flex flex-col gap-6">
      {/* 审批耗时埋点（Phase3 3.1）——只计时不渲染，两个 ReviewPanel 用处
          （/review 页 + 侧边栏 tab）都自动带上。 */}
      <ApprovalTimer pendingCount={pending.length} />
      <section>
        <h2 className="text-sm font-medium mb-3">
          待确认
          <span className="text-black/40 dark:text-white/40 ml-2">
            {pending.length} 项
          </span>
        </h2>
        {pendingGroups.length === 0 && (
          <p className="text-sm text-black/40 dark:text-white/40">
            没有待确认的提议。
          </p>
        )}
        {pendingRows.map(({ group, showDayHeader, nodeIds, edgeIds }) => (
          <div key={group.key}>
            {showDayHeader && (
              <div className="text-xs text-black/40 dark:text-white/40 mt-4 mb-1.5 first:mt-0">
                {group.day}
              </div>
            )}
            <div className="border border-dashed border-black/20 dark:border-white/20 rounded p-3 mb-3">
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="text-sm">
                  <span className="font-medium">
                    {group.batchId ? "捕获批次" : "人工创建"}
                  </span>
                  <span className="text-black/40 dark:text-white/40 ml-2">
                    {group.items.length} 条
                    {group.channel && ` · ${CHANNEL_LABELS[group.channel] ?? group.channel}`}
                  </span>
                </div>
                {group.items.length > 1 && (
                  <div className="flex gap-2 shrink-0">
                    <form action={acceptBatch.bind(null, nodeIds, edgeIds)}>
                      <button type="submit" className={buttonClass}>
                        整批接受
                      </button>
                    </form>
                    <form action={rejectBatch.bind(null, nodeIds, edgeIds)}>
                      <button type="submit" className={buttonClass}>
                        整批拒绝
                      </button>
                    </form>
                  </div>
                )}
              </div>
              <ul className="flex flex-col">
                {group.items.map((item) => (
                  <PendingItemRow key={item.kind === "node" ? item.node.id : item.edge.id} item={item} />
                ))}
              </ul>
            </div>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-sm font-medium mb-3">
          已自动生效（可撤销）
          <span className="text-black/40 dark:text-white/40 ml-2">
            {revocable.length} 项
          </span>
        </h2>
        {revocable.length === 0 && (
          <p className="text-sm text-black/40 dark:text-white/40">
            没有已自动生效的低风险边。
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {revocable.map((item) => (
            <RevocableItemRow key={item.edge.id} item={item} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function PendingItemRow({ item }: { item: ReviewItem }) {
  if (item.kind === "node") {
    return (
      <li className="flex items-center justify-between gap-2 py-1.5 border-b border-black/5 dark:border-white/5 last:border-0 text-sm">
        <Link href={`/node/${item.node.id}`} className="min-w-0 flex-1 truncate">
          <span className="text-black/40 dark:text-white/40">
            [{NODE_TYPE_LABELS[item.node.type]}]{" "}
          </span>
          {item.node.title}
        </Link>
        <span className="flex gap-1 shrink-0">
          <form action={acceptNode.bind(null, item.node.id)}>
            <button type="submit" className={buttonClass}>
              接受
            </button>
          </form>
          <form action={rejectNode.bind(null, item.node.id)}>
            <button type="submit" className={buttonClass}>
              拒绝
            </button>
          </form>
        </span>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-2 py-1.5 border-b border-black/5 dark:border-white/5 last:border-0 text-sm">
      <span className="min-w-0 flex-1 truncate">
        <Link href={`/node/${item.edge.srcId}`} className="underline">
          {item.srcNode?.title ?? "（未知节点）"}
        </Link>
        <span className="text-black/40 dark:text-white/40">
          {" "}
          —{EDGE_TYPE_LABELS[item.edge.type]}→{" "}
        </span>
        <Link href={`/node/${item.edge.dstId}`} className="underline">
          {item.dstNode?.title ?? "（未知节点）"}
        </Link>
      </span>
      <span className="flex gap-1 shrink-0">
        <form action={acceptEdge.bind(null, item.edge.id)}>
          <button type="submit" className={buttonClass}>
            接受
          </button>
        </form>
        <form action={rejectPendingEdge.bind(null, item.edge.id)}>
          <button type="submit" className={buttonClass}>
            拒绝
          </button>
        </form>
      </span>
    </li>
  );
}

function RevocableItemRow({ item }: { item: ReviewEdgeItem }) {
  return (
    <li className="flex items-center justify-between gap-2 p-2 border border-black/10 dark:border-white/10 rounded text-sm">
      <span className="min-w-0 flex-1 truncate">
        <Link href={`/node/${item.edge.srcId}`} className="underline">
          {item.srcNode?.title ?? "（未知节点）"}
        </Link>
        <span className="text-black/40 dark:text-white/40">
          {" "}
          —{EDGE_TYPE_LABELS[item.edge.type]}→{" "}
        </span>
        <Link href={`/node/${item.edge.dstId}`} className="underline">
          {item.dstNode?.title ?? "（未知节点）"}
        </Link>
        {item.provenance?.confidence != null && (
          <span className="text-black/40 dark:text-white/40 ml-2">
            相似度 {(item.provenance.confidence * 100).toFixed(0)}%
          </span>
        )}
      </span>
      <form action={revertConfirmedEdge.bind(null, item.edge.id)}>
        <button type="submit" className={`${buttonClass} shrink-0`}>
          撤销
        </button>
      </form>
    </li>
  );
}
