import { NextResponse } from "next/server";
import { getNode, getNodeNeighborhood, listAllNodes } from "@/lib/graph";
import { DEFAULT_PROJECT_ID } from "@/lib/config";

/**
 * 侧边栏"锚定当前节点"的数据源（Phase1-开工计划.md 1.4，PRD R6）。
 * 独立成一个轻量 route handler，而不是把这块数据塞进
 * app/(workbench)/layout.tsx 的 Server Component 里——布局包裹所有
 * 页面，拿不到 `/node/[id]` 这个子路由的动态段参数；侧边栏组件用
 * `usePathname()` 探测当前节点 id，再打这个接口，天然只在看节点详情页
 * 时才请求，<1s 内跟随导航切换。
 *
 * 纯图查询，不调用任何模型——决策点 7"AI 每次露面都必须带图的引用"，
 * 这里干脆没有生成，只有确定性的邻域查询，零幻觉风险。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const node = await getNode(id);
  if (!node) {
    return NextResponse.json({ error: "node not found" }, { status: 404 });
  }

  const [{ outgoing, incoming }, allNodes] = await Promise.all([
    getNodeNeighborhood(id),
    listAllNodes(DEFAULT_PROJECT_ID),
  ]);
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));

  return NextResponse.json({
    // body 加进来，供审批页就地预览（components/review-preview.tsx）一次
    // fetch 拿全正文 + 上下文。侧边栏那个消费方多一个字段无害、不用改。
    node: {
      id: node.id,
      title: node.title,
      type: node.type,
      status: node.status,
      body: node.body,
    },
    outgoing: outgoing.map((e) => ({
      id: e.id,
      type: e.type,
      status: e.status,
      targetId: e.dstId,
      targetTitle: nodeById.get(e.dstId)?.title ?? null,
      targetType: nodeById.get(e.dstId)?.type ?? null,
    })),
    incoming: incoming.map((e) => ({
      id: e.id,
      type: e.type,
      status: e.status,
      sourceId: e.srcId,
      sourceTitle: nodeById.get(e.srcId)?.title ?? null,
      sourceType: nodeById.get(e.srcId)?.type ?? null,
    })),
  });
}
