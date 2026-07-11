import { db } from "@/db/client";
import { events } from "@/db/schema";
import { DEFAULT_PROJECT_ID } from "@/lib/config";

/**
 * Phase3-开工计划.md 决策 K/L：dogfooding 埋点的唯一入口。
 *
 * 三条原则，都是"埋点永不拖累用户操作"的具体化：
 *  1. **可关**（决策 K）：`TELEMETRY_ENABLED=false` 时静默 no-op，产品功能
 *     不受影响（呼应 PRD Non-Goal"遥测可关"）。默认 on——dogfooding 需要它 on。
 *  2. **fire-and-forget**：不 await、失败只 warn，绝不 throw 到调用点。审批/
 *     追溯这些用户动作不能因为写一条统计事件失败而卡住或报错。
 *  3. **测试不写库**：`VITEST` 下短路（同 lib/graph 的 embed 入队做法），
 *     避免单测在测试库里堆脏事件、也避免 rollup 单测自造数据被干扰。
 */

export type EventKind = "retrieval" | "citation_click" | "approval_session";

const telemetryEnabled = process.env.TELEMETRY_ENABLED !== "false";

export function emitEvent(
  kind: EventKind,
  payload: Record<string, unknown>,
  projectId: string = DEFAULT_PROJECT_ID,
): void {
  if (!telemetryEnabled) return;
  if (process.env.VITEST) return;

  // 不 await：即发即忘。写失败吞掉，只留一条 warn 供排查，不冒泡。
  void db
    .insert(events)
    .values({ kind, payload, projectId })
    .catch((err) => {
      console.warn(`[metrics] emitEvent(${kind}) 写入失败（已忽略）:`, err);
    });
}
