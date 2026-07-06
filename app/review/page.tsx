import { listPendingReview } from "@/lib/graph";
import { DEFAULT_PROJECT_ID } from "@/lib/config";
import { ReviewPanel } from "@/components/review-panel";

/**
 * 审批的独立宽屏页面（Phase1-开工计划.md 1.3）。同一套渲染/数据/
 * Server Actions 也被侧边栏审批 tab 复用（components/review-panel.tsx）
 * ——这里只是加一层页面级的标题和留白，实际逻辑不在这个文件里。
 */
export default async function ReviewPage() {
  const review = await listPendingReview(DEFAULT_PROJECT_ID);

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-lg font-medium mb-1">审批</h1>
      <p className="text-xs text-black/40 dark:text-white/40 mb-6">
        高风险边（支撑/因为/验证/证伪）必须在这里显式确认才对检索可见；
        低风险边（重复/阻塞）已自动生效，这里只是给你撤销的机会。
      </p>
      <ReviewPanel review={review} />
    </div>
  );
}
