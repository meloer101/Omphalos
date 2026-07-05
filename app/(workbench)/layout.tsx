import Link from "next/link";

/**
 * 三栏工作台外壳（PRD R2/R6）：左导航 / 中变形栏 / 右侧栏占位。
 * AI 侧边栏在 Phase 1 才实现交互；这里先占位以验证"关闭 AI 后
 * 工作台仍完整可用"这条降级原则从骨架阶段就成立。
 */
export default function WorkbenchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      </nav>

      <main className="flex-1 min-w-0 overflow-auto">{children}</main>

      <aside className="w-80 shrink-0 border-l border-black/10 dark:border-white/10 p-4 text-sm text-black/40 dark:text-white/40">
        AI 侧边栏（Phase 1 实现）
      </aside>
    </div>
  );
}
