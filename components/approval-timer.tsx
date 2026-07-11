"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * 审批耗时埋点（Phase3-开工计划.md 3.1，决策 L）。嵌在 ReviewPanel 里，
 * 只做计时、不渲染任何东西。度量"面板可见且有待确认提议"的那段停留：
 *
 *  - 一进来有 pending 就开始计时，记下起始时的批量大小（batchSize）。
 *  - pending 数降到 0（这批批完了，Server Action revalidate 后 prop 变 0）
 *    → 发一条 approval_session，然后停表。这是"批完"信号。
 *  - 用户中途离开（页面 pagehide / 切到后台）→ 用 beacon 把当前已耗时发出去。
 *
 * 服务端对 durationMs 还会再清洗（>20 分钟视为挂着没看，丢弃）。计时永不
 * 影响审批操作本身——纯旁路。所有 ref/计时逻辑都在 effect 内，不在 render 期
 * （React 19 规则：render 必须纯，不碰 ref.current、不调 performance.now）。
 */
export function ApprovalTimer({ pendingCount }: { pendingCount: number }) {
  const startRef = useRef<number | null>(null);
  const batchSizeRef = useRef(0);
  const sentRef = useRef(false);

  const report = useCallback((useBeacon: boolean) => {
    if (startRef.current === null || sentRef.current) return;
    const durationMs = performance.now() - startRef.current;
    sentRef.current = true;
    const body = JSON.stringify({ durationMs, batchSize: batchSizeRef.current });
    try {
      if (useBeacon) {
        navigator.sendBeacon?.(
          "/api/metrics/approval-session",
          new Blob([body], { type: "application/json" }),
        );
      } else {
        void fetch("/api/metrics/approval-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        });
      }
    } catch {
      // 尽力而为。
    }
  }, []);

  // 计时状态机：起点（首次有 pending）与终点（批完，pending 归 0）都在 effect 里。
  useEffect(() => {
    if (pendingCount > 0 && startRef.current === null) {
      startRef.current = performance.now();
      batchSizeRef.current = pendingCount;
      sentRef.current = false;
    } else if (pendingCount === 0 && startRef.current !== null && !sentRef.current) {
      report(false);
      startRef.current = null; // 允许下一批重新计时
    }
  }, [pendingCount, report]);

  // 中途离开：页面卸载时 fetch 不可靠，用 beacon 把已耗时送出去。
  useEffect(() => {
    function onHide() {
      if (document.visibilityState === "hidden") report(true);
    }
    function onPageHide() {
      report(true);
    }
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [report]);

  return null;
}
