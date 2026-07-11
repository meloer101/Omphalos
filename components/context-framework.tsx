import type { ReactNode } from "react";
import { EDGE_TYPE_LABELS } from "@/lib/labels";
import type { EdgeType } from "@/db/enums";

/**
 * 上下文关系框架图（Phase3，按用户示意图）：把当前节点的关系画成上中下三层
 * 竖向流程——
 *   上层 = 指向本条的（入边来源）
 *   中间 = 本条信息（当前节点）
 *   下层 = 本条指向的（出边目标）
 * 层间用向下箭头串起来，方向即关系流向。对端节点可点，点击行为由调用方
 * 传入的 renderLink 决定（预览里就地切换、侧边栏里跳转）。每条链接带上关系
 * 类型（支撑/因为/…），不丢语义。加粗+下划线的是对端（论据/支撑），引导点击；
 * 中间的"本条信息"是已知锚点，不抢焦点。
 */

export interface FrameworkEdge {
  id: string;
  type: EdgeType;
  otherId?: string;
  otherTitle?: string | null;
}

export function ContextFramework({
  incoming,
  outgoing,
  renderLink,
}: {
  incoming: FrameworkEdge[];
  outgoing: FrameworkEdge[];
  renderLink: (id: string, title: string) => ReactNode;
}) {
  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <p className="text-black/40 dark:text-white/40">这个节点还没有任何边。</p>
    );
  }

  const edgeLine = (e: FrameworkEdge) => (
    <div key={e.id} className="leading-relaxed">
      <span className="text-xs text-black/40 dark:text-white/40">
        {EDGE_TYPE_LABELS[e.type]}{" "}
      </span>
      {e.otherId
        ? renderLink(e.otherId, e.otherTitle ?? "（未知节点）")
        : "（未知节点）"}
    </div>
  );

  const box = "rounded-lg border px-3 py-2 flex flex-col gap-1";

  return (
    <div className="flex flex-col items-stretch">
      {incoming.length > 0 && (
        <>
          <div className={`${box} border-black/15 dark:border-white/15`}>
            {incoming.map(edgeLine)}
          </div>
          <Arrow />
        </>
      )}

      <div className="rounded-lg border border-black/25 dark:border-white/25 bg-black/[0.03] dark:bg-white/[0.06] px-3 py-2 text-black/60 dark:text-white/60">
        本条信息
      </div>

      {outgoing.length > 0 && (
        <>
          <Arrow />
          <div className={`${box} border-black/15 dark:border-white/15`}>
            {outgoing.map(edgeLine)}
          </div>
        </>
      )}
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex justify-center py-1 text-lg leading-none text-black/30 dark:text-white/30">
      ↓
    </div>
  );
}
