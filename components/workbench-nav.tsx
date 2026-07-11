"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * 工作台左侧导航（Phase3：从 WorkbenchChrome 抽出，修 /review 缺导航的不一致）。
 * 两处复用——WorkbenchChrome（带 AI 侧边栏的普通页面）和 /review（自成三栏、
 * 不要 AI 侧边栏）。`footer` 放各页面特有的底部内容（如侧边栏开关），没有就不占位。
 */

const LINKS = [
  { href: "/inbox", label: "反馈收件箱" },
  { href: "/board", label: "看板" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/review", label: "审批" },
  { href: "/import", label: "导入" },
  { href: "/metrics", label: "指标" },
];

export function WorkbenchNav({
  footer,
  fill,
}: {
  footer?: ReactNode;
  // fill：撑满父容器（审批页里放进可拖拽 Panel，宽度交给 Panel 控制、分隔线
  // 交给拖拽手柄）。默认是固定宽度 + 右边框的普通侧栏（WorkbenchChrome 用）。
  fill?: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav
      className={`p-4 flex flex-col gap-1 ${
        fill
          ? "w-full h-full overflow-auto"
          : "w-56 shrink-0 border-r border-black/10 dark:border-white/10"
      }`}
    >
      <div className="text-sm font-medium mb-3 px-2">Omphalos</div>
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`px-2 py-1.5 rounded text-sm hover:bg-black/5 dark:hover:bg-white/5 ${
              active ? "bg-black/5 dark:bg-white/10 font-medium" : ""
            }`}
          >
            {l.label}
          </Link>
        );
      })}
      {footer && <div className="mt-auto">{footer}</div>}
    </nav>
  );
}
