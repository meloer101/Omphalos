"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * 订阅 graph_proposals SSE 流（Phase1-开工计划.md 1.0 建的通道，1.4
 * 第一次真正接上消费方）。新提议落库后调用 router.refresh()——这会
 * 重新执行当前路由的 Server Component 树（含这个共享布局），侧边栏
 * 审批 tab 的数据自动变新，不用另起一套客户端数据获取逻辑。
 *
 * 只在侧边栏打开时挂载（见 components/workbench-chrome.tsx）——关闭
 * 侧边栏时不维持这个连接，呼应"AI 整体退场"（G5）：不只是不显示 DOM，
 * 后台的 AI 相关连接也一起收起。
 */
export function SidebarLiveRefresh() {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/proposals/stream");
    source.onmessage = () => {
      // 一次捕获批次会连续触发多条 NOTIFY——去抖，避免刷新风暴。
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => router.refresh(), 300);
    };
    return () => {
      source.close();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [router]);

  return null;
}
