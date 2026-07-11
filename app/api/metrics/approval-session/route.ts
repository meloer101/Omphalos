import { emitEvent } from "@/lib/metrics/emit";

/**
 * Phase3-开工计划.md 3.1：日均审批耗时的采集端点（决策 L）。审批面板的
 * ApprovalTimer（client）在"这批提议批完"或"用户中途离开"时打过来一条
 * 停留时长。beacon 或 fetch 均可。
 *
 * 服务端只认这一个 kind，durationMs 做基本清洗（正数、且 <20 分钟——超过
 * 视为挂着没看的 idle，不计入，呼应计划"避免把挂着不看的时间算进去"）。
 */
const MAX_SESSION_MS = 20 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const durationMs = Number(body?.durationMs);
    const batchSize = Number(body?.batchSize);
    if (
      Number.isFinite(durationMs) &&
      durationMs > 0 &&
      durationMs < MAX_SESSION_MS
    ) {
      emitEvent("approval_session", {
        durationMs: Math.round(durationMs),
        batchSize: Number.isFinite(batchSize) ? batchSize : null,
      });
    }
  } catch {
    // 埋点尽力而为。
  }
  return new Response(null, { status: 204 });
}
