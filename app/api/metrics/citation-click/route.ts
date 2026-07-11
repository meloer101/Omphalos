import { emitEvent } from "@/lib/metrics/emit";

/**
 * Phase3-开工计划.md 3.1：引用点击率的采集端点（决策 L）。Cmd-K 答案里的
 * 行内蓝链被点时，前端用 navigator.sendBeacon 打到这里（beacon 能在页面
 * 跳转到 /node/[id] 时仍把请求发出去）。
 *
 * 分子=citation_click 事件数，分母=retrieval 里 outcome:answer 的次数。
 * 点击=用户在验证答案=信任行为（PRD §6 指标注释）。
 *
 * 埋点永不阻塞：解析失败也返回 204，不让前端感知任何错误。
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const nodeId = typeof body?.nodeId === "string" ? body.nodeId : undefined;
    const question =
      typeof body?.question === "string" ? body.question.slice(0, 500) : undefined;
    if (nodeId) {
      emitEvent("citation_click", { nodeId, question });
    }
  } catch {
    // sendBeacon 的 body 偶发解析不出——忽略，指标少一条无所谓。
  }
  return new Response(null, { status: 204 });
}
