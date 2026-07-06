import { cookies } from "next/headers";
import { listPendingReview } from "@/lib/graph";
import { DEFAULT_PROJECT_ID, SIDEBAR_OPEN_COOKIE } from "@/lib/config";
import { ReviewPanel } from "@/components/review-panel";
import { WorkbenchChrome } from "@/components/workbench-chrome";

/**
 * 三栏工作台外壳（PRD R2/R6）：左导航 / 中变形栏 / 右侧栏。1.4 把
 * 侧边栏从占位文案换成真正的可开关框架（components/workbench-chrome.tsx）
 * ——数据获取（读 cookie、查审批数据）留在这个 Server Component，交互
 * 状态（开关、切 tab）交给下面的 Client Component，边界清楚。
 *
 * 用了 cookies() 之后这个布局包裹的所有页面都变成动态渲染——这是预期
 * 且正确的：侧边栏的审批数据本来就该是每次请求的实时快照，不该是
 * 构建时的静态快照。
 */
export default async function WorkbenchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get(SIDEBAR_OPEN_COOKIE)?.value !== "0";

  const review = await listPendingReview(DEFAULT_PROJECT_ID);

  return (
    <WorkbenchChrome
      defaultOpen={sidebarOpen}
      reviewPanel={<ReviewPanel review={review} />}
    >
      {children}
    </WorkbenchChrome>
  );
}
