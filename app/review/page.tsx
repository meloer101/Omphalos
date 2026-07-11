import { listPendingReview } from "@/lib/graph";
import { DEFAULT_PROJECT_ID } from "@/lib/config";
import { ReviewWorkspace } from "@/components/review-workspace";

/**
 * 审批页（Phase3 改版）：三栏「导航 | 列表 | 就地预览」。此前这个页面在
 * (workbench) 路由组之外、套不到三栏外壳，所以没有左导航——现在自己带上
 * WorkbenchNav 修一致性；点列表项在右侧预览、不再整页跳转（详见计划文件）。
 * 侧边栏的「审批」tab 仍用 components/review-panel.tsx，不受影响。
 */
// 审批列表是每次请求的实时快照，不能被构建期静态预渲染成陈旧数据。
export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const review = await listPendingReview(DEFAULT_PROJECT_ID);

  // ReviewWorkspace 自己是一个撑满视口高度的横向 PanelGroup（导航/列表/预览
  // 三栏可拖），所以这里不再套外层 flex 容器。
  return <ReviewWorkspace pending={review.pending} />;
}
