import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueCapture } from "@/lib/agents/contracts/capture";
import { DEFAULT_PROJECT_ID } from "@/lib/config";

const bodySchema = z.object({
  subject: z.string().optional(),
  text: z.string().min(1),
});

/**
 * 邮件转发 webhook 占位（Phase1-开工计划.md 1.2，决策 B）：接口先立
 * 住，不接任何真实收信服务（Postmark/SendGrid inbound parse 等）——
 * P1 阶段没有谁会真的 POST 到这里。P4 接真实邮件转发时，只需要把这个
 * URL 配成收信服务的 webhook 目标，这里的逻辑不用改（PRD 把邮件列为
 * "食物"，不是承重墙）。
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

  const rawText = parsed.data.subject
    ? `${parsed.data.subject}\n\n${parsed.data.text}`
    : parsed.data.text;

  const jobId = await enqueueCapture({
    projectId: DEFAULT_PROJECT_ID,
    channel: "inbound-email",
    head: "feedback",
    rawText,
  });

  return NextResponse.json({ jobId }, { status: 202 });
}
