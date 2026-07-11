"use client";

import { PanelResizeHandle } from "react-resizable-panels";

/**
 * 拖拽分隔条（Phase3：审批页四板块可调大小）。`direction` 跟随所在 PanelGroup：
 *   horizontal（左右分栏）→ 一条竖线，左右拖（col-resize）
 *   vertical（上下分栏）  → 一条横线，上下拖（row-resize）
 * 平时是一条淡淡的细线，hover / 拖拽时变蓝，给出可拖暗示；命中区比可见线宽，
 * 好抓。
 */
export function ResizeHandle({
  direction,
}: {
  direction: "horizontal" | "vertical";
}) {
  const isH = direction === "horizontal";
  return (
    <PanelResizeHandle
      className={`group relative shrink-0 flex items-center justify-center ${
        isH ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize"
      }`}
    >
      <div
        className={`bg-black/10 dark:bg-white/10 transition-colors group-hover:bg-blue-400 group-data-[resize-handle-state=drag]:bg-blue-500 ${
          isH ? "w-px h-full" : "h-px w-full"
        }`}
      />
    </PanelResizeHandle>
  );
}
