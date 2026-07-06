import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueCapture } from "@/lib/agents/contracts/capture";
import { DEFAULT_PROJECT_ID } from "@/lib/config";

const bodySchema = z.object({
  rawText: z.string().min(1),
  head: z.enum(["feedback", "meeting"]).optional(),
});

/**
 * 粘贴文本入口（Phase1-开工计划.md 1.2，决策 B）。立即返回 job id，
 * 不等模型跑完——捕获处理是异步的（Phase0-开工计划.md 0.4 spike：
 * 思考模型均值 ~11s 延迟，绝不能同步阻塞等待）。
 */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const jobId = await enqueueCapture({
    projectId: DEFAULT_PROJECT_ID,
    channel: "paste",
    head: parsed.data.head,
    rawText: parsed.data.rawText,
  });

  return NextResponse.json({ jobId }, { status: 202 });
}
