import { config } from "dotenv";
// 必须在其余 import 之前显式调用——独立脚本里 import 会被提升到所有
// 代码之前执行，见 lib/ai/client.ts 的同一个坑。
config({ path: ".env.local" });

import { getBoss, QUEUE } from "@/lib/queue/boss";
import { runPipeline } from "@/lib/agents/runtime";
import {
  captureContract,
  type CaptureInput,
} from "@/lib/agents/contracts/capture";
import { embedNode } from "@/lib/embed";

/**
 * Worker 入口（Phase1-开工计划.md 1.0）：独立 node 进程，`pnpm worker`
 * 起。P1 只有一份合同（捕获）要跑，只注册这一个 job handler；P2+ 新增
 * 合同时在这里加对应的 `boss.work(...)` 调用。
 *
 * 前置条件：本地 Supabase（`pnpm supabase:start`）+ LiteLLM
 * （`pnpm litellm:start`）已起。
 */
async function main() {
  const boss = await getBoss();

  await boss.work<CaptureInput>(QUEUE.capture, async (jobs) => {
    for (const job of jobs) {
      // job.id 就是这次捕获的批次键（Phase1-开工计划.md 1.3）——写进
      // sourceRef.detail.batchId，审批 tab 按批次分组时用它。
      const result = await runPipeline(captureContract, {
        ...job.data,
        batchId: job.id,
      });
      console.log(
        `[capture] job ${job.id} 完成：${result.nodeIds.length} 个证据节点，${result.edgeIds.length} 条边`,
      );
    }
  });

  // 语义索引 job（Phase2-开工计划.md 2.1）：节点正文写入后由 lib/graph
  // 入队，这里异步算向量写回 nodes.embedding。失败由队列 retryLimit 兜底。
  await boss.work<{ nodeId: string }>(QUEUE.embed, async (jobs) => {
    for (const job of jobs) {
      await embedNode(job.data.nodeId);
    }
  });

  console.log("worker 已启动，监听 capture / embed / import 队列...");

  const shutdown = async () => {
    console.log("worker 关闭中...");
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("worker 启动失败:", err);
  process.exit(1);
});
