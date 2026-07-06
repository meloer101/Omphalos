import { db } from "@/db/client";

/**
 * SSE：把新提议实时推给审批 tab（Phase1-开工计划.md 1.0）。这个频道
 * 只干这一件事——不是多 Agent 编排总线（见架构文档决策 A 的取舍）。
 * 必须动态渲染：这是一个长连接，不能被预渲染/缓存。
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let stopListening: (() => Promise<void>) | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));

      const { unlisten } = await db.$client.listen(
        "graph_proposals",
        (payload) => {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        },
      );
      stopListening = unlisten;
    },
    async cancel() {
      await stopListening?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
