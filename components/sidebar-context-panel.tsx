"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { EDGE_TYPE_LABELS, NODE_TYPE_LABELS } from "@/lib/labels";
import type { NodeType, EdgeType, EdgeStatus } from "@/db/enums";

interface ContextEdge {
  id: string;
  type: EdgeType;
  status: EdgeStatus;
  targetId?: string;
  targetTitle?: string | null;
  sourceId?: string;
  sourceTitle?: string | null;
}

interface NodeContext {
  node: { id: string; title: string; type: NodeType };
  outgoing: ContextEdge[];
  incoming: ContextEdge[];
}

function extractNodeId(pathname: string): string | null {
  const match = pathname.match(/^\/node\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * 侧边栏"锚定当前节点"面板（Phase1-开工计划.md 1.4，PRD R6）。用
 * usePathname 探测当前是否在看某个节点，是的话打 app/api/node/[id]/
 * context 拿它的证据链/所属需求——纯图查询，没有模型调用，切换<1s。
 *
 * 不在节点详情页时显示空状态而不是报错——侧边栏"永远锚定当前节点"，
 * 但没有节点可锚时就诚实地说没有，不硬凑内容（决策点 7：不做万能助手）。
 */
export function SidebarContextPanel() {
  const pathname = usePathname();
  const nodeId = extractNodeId(pathname);
  // 存"这份结果属于哪个 nodeId"而不是单独一个 loading 布尔量——
  // loading 直接从 "结果的 nodeId 和当前 nodeId 是否一致" derive 出来，
  // effect 里就只需要在异步回调里 setState 一次，不用在 effect body
  // 顶部同步调用 setState 去"开始加载"（react-hooks/set-state-in-effect）。
  const [result, setResult] = useState<{ nodeId: string; context: NodeContext | null } | null>(
    null,
  );

  useEffect(() => {
    if (!nodeId) return;
    let cancelled = false;
    fetch(`/api/node/${nodeId}/context`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: NodeContext | null) => {
        if (!cancelled) setResult({ nodeId, context: data });
      })
      .catch(() => {
        if (!cancelled) setResult({ nodeId, context: null });
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  if (!nodeId) {
    return (
      <p className="text-sm text-black/40 dark:text-white/40">
        打开一个节点详情页时，这里会显示它的证据链和所属需求。
      </p>
    );
  }

  const loading = result?.nodeId !== nodeId;
  const context = loading ? null : result?.context ?? null;

  if (loading) {
    return <p className="text-sm text-black/40 dark:text-white/40">加载中…</p>;
  }

  if (!context) {
    return (
      <p className="text-sm text-black/40 dark:text-white/40">找不到这个节点。</p>
    );
  }

  const hasEdges = context.outgoing.length > 0 || context.incoming.length > 0;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <span className="text-black/40 dark:text-white/40">
          [{NODE_TYPE_LABELS[context.node.type]}]{" "}
        </span>
        <Link href={`/node/${context.node.id}`} className="font-medium underline">
          {context.node.title}
        </Link>
      </div>

      {context.outgoing.length > 0 && (
        <div>
          <div className="text-xs text-black/40 dark:text-white/40 mb-1">出边</div>
          <ul className="flex flex-col gap-1">
            {context.outgoing.map((e) => (
              <li key={e.id}>
                <span className="text-black/40 dark:text-white/40">
                  {EDGE_TYPE_LABELS[e.type]} →{" "}
                </span>
                {e.targetId ? (
                  <Link href={`/node/${e.targetId}`} className="underline">
                    {e.targetTitle ?? "（未知节点）"}
                  </Link>
                ) : (
                  "（未知节点）"
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {context.incoming.length > 0 && (
        <div>
          <div className="text-xs text-black/40 dark:text-white/40 mb-1">入边</div>
          <ul className="flex flex-col gap-1">
            {context.incoming.map((e) => (
              <li key={e.id}>
                {e.sourceId ? (
                  <Link href={`/node/${e.sourceId}`} className="underline">
                    {e.sourceTitle ?? "（未知节点）"}
                  </Link>
                ) : (
                  "（未知节点）"
                )}
                <span className="text-black/40 dark:text-white/40">
                  {" "}
                  —{EDGE_TYPE_LABELS[e.type]}→ 本节点
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasEdges && (
        <p className="text-black/40 dark:text-white/40">
          这个节点还没有任何边。
        </p>
      )}
    </div>
  );
}
