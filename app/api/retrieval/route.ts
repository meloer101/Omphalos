import { answerQuestion, NO_RECORD_MESSAGE } from "@/lib/retrieval/answer";
import { DEFAULT_PROJECT_ID } from "@/lib/config";

/**
 * 追溯问答入口（Phase2-开工计划.md 2.2，PRD R4）。Cmd-K 把问题 POST 到
 * 这里，两段式检索 + 流式生成。全程只读（answer.ts 内部走 getDbReadonly），
 * 长连接不能被缓存/预渲染。
 *
 * 响应协议（自定义轻量分帧，前端 cmd-k-search.tsx 对应解析）：
 *  - no_record：普通 JSON `{ kind:"no_record", message }`。
 *  - answer：流式。**第一行**是单行 JSON 元数据 `{ kind:"answer", scope, sources }`
 *    （JSON.stringify 保证不含裸换行），`\n` 之后是模型逐字产出的答案原文
 *    （含 [句柄] 标记）。前端拿到 sources 建句柄映射，再用 lib/retrieval/cite.ts
 *    边收边解析成行内引用。
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let question = "";
  try {
    const body = await request.json();
    question = typeof body?.question === "string" ? body.question.trim() : "";
  } catch {
    question = "";
  }
  if (!question) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }

  let result;
  try {
    result = await answerQuestion(question, DEFAULT_PROJECT_ID);
  } catch (err) {
    // 检索前置步骤（问题向量化 / 图查询）失败——最常见是 embedding 模型
    // 没配好或不可用。返回干净的错误 JSON，让 Cmd-K 面板显示"出错了"，
    // 而不是让前端卡在"检索中…"（错误里不回传细节，避免泄露内部配置）。
    console.error("[retrieval] answerQuestion 失败:", err);
    return Response.json(
      { kind: "error", error: "检索暂时不可用" },
      { status: 500 },
    );
  }

  if (result.kind === "no_record") {
    return Response.json({ kind: "no_record", message: NO_RECORD_MESSAGE });
  }

  const encoder = new TextEncoder();
  const { scope, sources, textStream } = result;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(JSON.stringify({ kind: "answer", scope, sources }) + "\n"),
      );
      try {
        for await (const delta of textStream) {
          controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        console.error("[retrieval] 流式生成出错:", err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
