"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { SIDEBAR_OPEN_COOKIE } from "@/lib/config";
import { SidebarContextPanel } from "./sidebar-context-panel";
import { SidebarCapturePanel } from "./sidebar-capture-panel";
import { SidebarLiveRefresh } from "./sidebar-live-refresh";
import { CmdKSearch } from "./cmd-k-search";

type Tab = "context" | "capture" | "review";

const TABS: { id: Tab; label: string }[] = [
  { id: "context", label: "上下文" },
  { id: "capture", label: "捕获" },
  { id: "review", label: "审批" },
];

function persistOpenState(open: boolean) {
  // 一年——纯 UI 偏好，没必要频繁过期；用户随时能再点开关切回来。
  document.cookie = `${SIDEBAR_OPEN_COOKIE}=${open ? "1" : "0"}; path=/; max-age=31536000`;
}

/**
 * 工作台外壳（Phase1-开工计划.md 1.4，PRD R6）：三栏布局 + 可开关的
 * AI 侧边栏，一个 Client Component 里管理开关/tab 状态，nav 里的
 * 开关按钮和 aside 面板共享同一份状态。
 *
 * `children`（当前页面）和 `reviewPanel`（审批 tab 的内容）都是从
 * app/(workbench)/layout.tsx 这个 Server Component 传进来的已渲染
 * React 树——这里只负责摆放和显隐，不重新请求数据，两处审批入口
 * （这里的 tab 和独立的 /review 页）共用同一套 Server Action 和渲染
 * 逻辑（components/review-panel.tsx）。
 *
 * 关闭态（open=false）：aside 整块不渲染，SidebarLiveRefresh 的 SSE
 * 连接也随之卸载——"AI 整体退场"不只是视觉上不显示，后台连接也一起
 * 收起（G5 降级完整性）。
 */
export function WorkbenchChrome({
  children,
  reviewPanel,
  defaultOpen,
}: {
  children: ReactNode;
  reviewPanel: ReactNode;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<Tab>("context");

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      persistOpenState(next);
      return next;
    });
  }

  return (
    <div className="flex h-full min-h-screen">
      <nav className="w-56 shrink-0 border-r border-black/10 dark:border-white/10 p-4 flex flex-col gap-1">
        <div className="text-sm font-medium mb-3 px-2">Omphalos</div>
        <Link
          className="px-2 py-1.5 rounded text-sm hover:bg-black/5 dark:hover:bg-white/5"
          href="/inbox"
        >
          反馈收件箱
        </Link>
        <Link
          className="px-2 py-1.5 rounded text-sm hover:bg-black/5 dark:hover:bg-white/5"
          href="/board"
        >
          看板
        </Link>
        <Link
          className="px-2 py-1.5 rounded text-sm hover:bg-black/5 dark:hover:bg-white/5"
          href="/roadmap"
        >
          Roadmap
        </Link>
        <Link
          className="px-2 py-1.5 rounded text-sm hover:bg-black/5 dark:hover:bg-white/5"
          href="/review"
        >
          审批
        </Link>
        <Link
          className="px-2 py-1.5 rounded text-sm hover:bg-black/5 dark:hover:bg-white/5"
          href="/import"
        >
          导入
        </Link>
        <button
          type="button"
          onClick={toggle}
          className="mt-auto px-2 py-1.5 rounded text-sm text-left hover:bg-black/5 dark:hover:bg-white/5"
        >
          {open ? "关闭 AI 侧边栏" : "打开 AI 侧边栏"}
        </button>
      </nav>

      <main className="flex-1 min-w-0 overflow-auto">{children}</main>

      {open && (
        <aside className="w-80 shrink-0 border-l border-black/10 dark:border-white/10 flex flex-col">
          <SidebarLiveRefresh />
          <div className="flex border-b border-black/10 dark:border-white/10 text-sm shrink-0">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 px-2 py-2 border-b-2 ${
                  tab === t.id
                    ? "border-black dark:border-white font-medium"
                    : "border-transparent text-black/50 dark:text-white/50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto p-4">
            {tab === "context" && <SidebarContextPanel />}
            {tab === "capture" && <SidebarCapturePanel />}
            {tab === "review" && reviewPanel}
          </div>
        </aside>
      )}

      {/* Cmd-K 追溯搜索栏——AI 露面，随侧边栏开关：关闭态不挂，保 G5 降级完整性。 */}
      {open && <CmdKSearch />}
    </div>
  );
}
