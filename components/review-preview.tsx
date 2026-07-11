"use client";

import { useEffect, useState } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import type { Block } from "@blocknote/core";
import { NodeBodyEditorLoader } from "@/components/node-body-editor-loader";
import { ContextFramework } from "@/components/context-framework";
import { ResizeHandle } from "@/components/resize-handle";
import { NODE_TYPE_LABELS } from "@/lib/labels";
import { saveNodeBody } from "@/app/(workbench)/node/[id]/actions";
import { acceptNode, rejectNode } from "@/app/review/actions";
import type { NodeType, EdgeType, EdgeStatus } from "@/db/enums";

/**
 * 审批页右侧的就地预览（Phase3，见 /Users/m/.claude/plans 计划）。选中一个
 * 节点就按 nodeId 从 /api/node/[id]/context 一次拿全「正文 body + 出/入边」，
 * 上半渲染正文（复用 NodeBodyEditorLoader，可改可存）+ 接受/拒绝，下半渲染
 * 上下文（复用 sidebar-context-panel 那套「当前节点加粗斜体、甲—关系→乙」）。
 * 点上下文里的对端节点 → onSelectNode 切换预览，不跳页。
 */

interface CtxEdge {
  id: string;
  type: EdgeType;
  status: EdgeStatus;
  targetId?: string;
  targetTitle?: string | null;
  sourceId?: string;
  sourceTitle?: string | null;
}

interface NodeCtx {
  node: { id: string; title: string; type: NodeType; status: string; body: unknown };
  outgoing: CtxEdge[];
  incoming: CtxEdge[];
}

const btn =
  "text-xs px-2 py-0.5 rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40";

export function ReviewPreview({
  nodeId,
  onSelectNode,
  onAfterDecision,
}: {
  nodeId: string;
  onSelectNode: (id: string) => void;
  onAfterDecision: (id: string) => void;
}) {
  const [result, setResult] = useState<{ nodeId: string; ctx: NodeCtx | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/node/${nodeId}/context`)
      .then((r) => (r.ok ? r.json() : null))
      .then((ctx: NodeCtx | null) => {
        if (!cancelled) setResult({ nodeId, ctx });
      })
      .catch(() => {
        if (!cancelled) setResult({ nodeId, ctx: null });
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  const loading = result?.nodeId !== nodeId;
  const ctx = loading ? null : result?.ctx ?? null;

  if (loading) {
    return <p className="p-4 text-sm text-black/40 dark:text-white/40">加载中…</p>;
  }
  if (!ctx) {
    return <p className="p-4 text-sm text-black/40 dark:text-white/40">找不到这个节点。</p>;
  }

  const { node, outgoing, incoming } = ctx;
  // 两种正文形状：BlockNote 富文本 {blocks}（手动/看板编辑的节点）、纯文本
  // {text}（捕获/导入熔出的节点，摘录或复述）。blocks 有就上可编辑器，否则
  // 直接只读展示 text——预览只为"看清内容好决定接受/拒绝"，不必都能编辑。
  const blocks = (node.body as { blocks?: Block[] })?.blocks ?? null;
  const text = (node.body as { text?: string })?.text ?? null;
  const isProposed = node.status === "proposed";
  // 对端节点（论据/支撑）加粗+下划线，引导点击。
  const linkClass =
    "underline font-semibold text-left text-black/80 dark:text-white/80 hover:text-black dark:hover:text-white";

  async function decide(fn: (id: string) => Promise<void>) {
    setBusy(true);
    try {
      await fn(node.id);
      onAfterDecision(node.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    // 正文 / 上下文两块可上下拖改高（Phase3）。这是嵌在审批页横向 PanelGroup
    // 里的纵向子 PanelGroup。
    <PanelGroup
      direction="vertical"
      autoSaveId="review-preview-v"
      className="h-full"
    >
      {/* 右上：正文预览 */}
      <Panel defaultSize={62} minSize={20}>
        <div className="h-full overflow-auto p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
          <div className="text-sm min-w-0">
            <span className="text-black/40 dark:text-white/40">
              [{NODE_TYPE_LABELS[node.type]}]{" "}
            </span>
            <span className="font-medium">{node.title}</span>
          </div>
          {isProposed && (
            <div className="flex gap-1 shrink-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => decide(acceptNode)}
                className={btn}
              >
                接受
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => decide(rejectNode)}
                className={btn}
              >
                拒绝
              </button>
            </div>
          )}
        </div>
        {blocks ? (
          <NodeBodyEditorLoader
            key={node.id}
            initialBlocks={blocks}
            onSave={saveNodeBody.bind(null, node.id)}
          />
        ) : text ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
        ) : (
          <p className="text-xs text-black/40 dark:text-white/40">（此节点暂无正文）</p>
        )}
        </div>
      </Panel>

      <ResizeHandle direction="vertical" />

      {/* 右下：上下文关系框架图 */}
      <Panel defaultSize={38} minSize={12}>
        <div className="h-full overflow-auto p-4 text-sm">
        <div className="text-xs text-black/40 dark:text-white/40 mb-2">上下文</div>
        <ContextFramework
          incoming={incoming.map((e) => ({
            id: e.id,
            type: e.type,
            otherId: e.sourceId,
            otherTitle: e.sourceTitle,
          }))}
          outgoing={outgoing.map((e) => ({
            id: e.id,
            type: e.type,
            otherId: e.targetId,
            otherTitle: e.targetTitle,
          }))}
          renderLink={(id, title) => (
            <button
              type="button"
              className={linkClass}
              onClick={() => onSelectNode(id)}
            >
              {title}
            </button>
          )}
        />
        </div>
      </Panel>
    </PanelGroup>
  );
}
