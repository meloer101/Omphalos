"use client";

import { useState } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import type { ReviewItem, ReviewNodeItem, ReviewEdgeItem } from "@/lib/graph";
import { groupReviewItems } from "@/app/review/group";
import { NODE_TYPE_LABELS, EDGE_TYPE_LABELS } from "@/lib/labels";
import { ApprovalTimer } from "@/components/approval-timer";
import { ReviewPreview } from "@/components/review-preview";
import { WorkbenchNav } from "@/components/workbench-nav";
import { ResizeHandle } from "@/components/resize-handle";
import {
  acceptNode,
  rejectNode,
  acceptEdge,
  rejectPendingEdge,
  acceptBatch,
  rejectBatch,
} from "@/app/review/actions";

/**
 * 审批页工作区（Phase3，见计划文件）：左=审批列表，右=就地预览。点节点项
 * 在右侧预览、不跳页；接受/拒绝后自动前进到下一条节点。审批耗时埋点
 * （ApprovalTimer）在这里挂上——原本嵌在 ReviewPanel 里，新工作区不走
 * ReviewPanel，必须自己带上，否则这条 dogfooding 指标在新 /review 页不采集。
 *
 * 节点的接受/拒绝走 client 直接 await server action，好在完成后推进选中态；
 * 边项与整批仍用 <form action> 提交（无需推进选中态）。两种都合法。
 */

const CHANNEL_LABELS: Record<string, string> = {
  paste: "粘贴文本",
  file: "文件上传",
  "inbound-email": "邮件转发",
};

const btn =
  "text-xs px-2 py-0.5 rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40";

export function ReviewWorkspace({ pending }: { pending: ReviewItem[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const nodeIds = pending
    .filter((i): i is ReviewNodeItem => i.kind === "node")
    .map((i) => i.node.id);

  // 接受/拒绝掉一个节点后，前进到下一条待确认节点（没有就清空选中）。
  function advanceFrom(decidedId: string) {
    const pos = nodeIds.indexOf(decidedId);
    const next = nodeIds[pos + 1] ?? nodeIds.find((id) => id !== decidedId) ?? null;
    setSelectedId(next);
  }

  async function decideNode(
    id: string,
    fn: (id: string) => Promise<void>,
  ) {
    setBusyId(id);
    try {
      await fn(id);
      advanceFrom(id);
    } finally {
      setBusyId(null);
    }
  }

  const groups = groupReviewItems(pending);

  return (
    // 外层锁死视口高度：react-resizable-panels 给 PanelGroup 打了 inline
    // height:100%，会盖掉 className 的 h-screen；必须让父容器有确定高度，
    // 100% 才解析成一屏，否则 PanelGroup 会被长列表撑到内容高。
    <div className="h-screen overflow-hidden">
      <ApprovalTimer pendingCount={pending.length} />
      {/* 四板块都可拖边框改大小（Phase3）：左右三栏一个横向 PanelGroup，
          右侧预览内部再套一个纵向 PanelGroup（在 ReviewPreview 里）。
          autoSaveId 让尺寸记进 localStorage，刷新后保持。 */}
      <PanelGroup
        direction="horizontal"
        autoSaveId="review-layout-h"
        className="h-full"
      >
        {/* 左：导航 */}
        <Panel defaultSize={15} minSize={8}>
          <WorkbenchNav fill />
        </Panel>
        <ResizeHandle direction="horizontal" />

        {/* 中：审批列表 */}
        <Panel defaultSize={30} minSize={16}>
          <div className="h-full overflow-auto p-4">
            <h1 className="text-lg font-medium mb-1">审批</h1>
        <p className="text-xs text-black/40 dark:text-white/40 mb-4">
          点一项在右侧预览，看完直接接受/拒绝，自动跳下一条。
        </p>
        <div className="text-xs text-black/40 dark:text-white/40 mb-2">
          待确认 {pending.length} 项
        </div>

        {groups.length === 0 && (
          <p className="text-sm text-black/40 dark:text-white/40">
            没有待确认的提议。
          </p>
        )}

        {groups.map((group) => {
          const gNodeIds = group.items
            .filter((i): i is ReviewNodeItem => i.kind === "node")
            .map((i) => i.node.id);
          const gEdgeIds = group.items
            .filter((i): i is ReviewEdgeItem => i.kind === "edge")
            .map((i) => i.edge.id);
          return (
            <div
              key={group.key}
              className="border border-dashed border-black/20 dark:border-white/20 rounded p-2 mb-3"
            >
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="text-xs">
                  <span className="font-medium">
                    {group.batchId ? "捕获批次" : "人工创建"}
                  </span>
                  <span className="text-black/40 dark:text-white/40 ml-2">
                    {group.items.length} 条
                    {group.channel &&
                      ` · ${CHANNEL_LABELS[group.channel] ?? group.channel}`}
                  </span>
                </div>
                {group.items.length > 1 && (
                  <div className="flex gap-1 shrink-0">
                    <form action={acceptBatch.bind(null, gNodeIds, gEdgeIds)}>
                      <button type="submit" className={btn}>
                        整批接受
                      </button>
                    </form>
                    <form action={rejectBatch.bind(null, gNodeIds, gEdgeIds)}>
                      <button type="submit" className={btn}>
                        整批拒绝
                      </button>
                    </form>
                  </div>
                )}
              </div>
              <ul className="flex flex-col">
                {group.items.map((item) =>
                  item.kind === "node" ? (
                    <NodeRow
                      key={item.node.id}
                      item={item}
                      selected={selectedId === item.node.id}
                      busy={busyId === item.node.id}
                      onSelect={() => setSelectedId(item.node.id)}
                      onAccept={() => decideNode(item.node.id, acceptNode)}
                      onReject={() => decideNode(item.node.id, rejectNode)}
                    />
                  ) : (
                    <EdgeRow
                      key={item.edge.id}
                      item={item}
                      onSelectNode={setSelectedId}
                    />
                  ),
                )}
              </ul>
                </div>
              );
            })}
          </div>
        </Panel>
        <ResizeHandle direction="horizontal" />

        {/* 右：预览（内部再纵向拆「正文 / 上下文」两块，见 ReviewPreview） */}
        <Panel defaultSize={55} minSize={25}>
          {selectedId ? (
            <ReviewPreview
              nodeId={selectedId}
              onSelectNode={setSelectedId}
              onAfterDecision={advanceFrom}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-black/30 dark:text-white/30">
              选一项在这里预览
            </div>
          )}
        </Panel>
      </PanelGroup>
    </div>
  );
}

function NodeRow({
  item,
  selected,
  busy,
  onSelect,
  onAccept,
  onReject,
}: {
  item: ReviewNodeItem;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <li
      className={`flex items-center justify-between gap-2 py-1.5 border-b border-black/5 dark:border-white/5 last:border-0 text-sm ${
        selected ? "bg-black/5 dark:bg-white/10 -mx-2 px-2 rounded" : ""
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 truncate text-left"
      >
        <span className="text-black/40 dark:text-white/40">
          [{NODE_TYPE_LABELS[item.node.type]}]{" "}
        </span>
        {item.node.title}
      </button>
      <span className="flex gap-1 shrink-0">
        <button type="button" disabled={busy} onClick={onAccept} className={btn}>
          接受
        </button>
        <button type="button" disabled={busy} onClick={onReject} className={btn}>
          拒绝
        </button>
      </span>
    </li>
  );
}

function EdgeRow({
  item,
  onSelectNode,
}: {
  item: ReviewEdgeItem;
  onSelectNode: (id: string) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-2 py-1.5 border-b border-black/5 dark:border-white/5 last:border-0 text-sm">
      <span className="min-w-0 flex-1 truncate">
        <button
          type="button"
          className="underline text-left"
          onClick={() => onSelectNode(item.edge.srcId)}
        >
          {item.srcNode?.title ?? "（未知节点）"}
        </button>
        <span className="text-black/40 dark:text-white/40">
          {" "}
          —{EDGE_TYPE_LABELS[item.edge.type]}→{" "}
        </span>
        <button
          type="button"
          className="underline text-left"
          onClick={() => onSelectNode(item.edge.dstId)}
        >
          {item.dstNode?.title ?? "（未知节点）"}
        </button>
      </span>
      <span className="flex gap-1 shrink-0">
        <form action={acceptEdge.bind(null, item.edge.id)}>
          <button type="submit" className={btn}>
            接受
          </button>
        </form>
        <form action={rejectPendingEdge.bind(null, item.edge.id)}>
          <button type="submit" className={btn}>
            拒绝
          </button>
        </form>
      </span>
    </li>
  );
}
