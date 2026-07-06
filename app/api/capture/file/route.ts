import { NextResponse } from "next/server";
import { enqueueCapture } from "@/lib/agents/contracts/capture";
import { DEFAULT_PROJECT_ID } from "@/lib/config";

const ALLOWED_EXTENSIONS = [".md", ".txt"];
// 1MB：这是捕获的原始素材入口，不是附件仓库——超出这个量级说明用户
// 想上传的是别的东西（导入历史数据是 P2 冷启动导入器的事）。
const MAX_FILE_BYTES = 1_000_000;

/** 文件上传入口（Phase1-开工计划.md 1.2，决策 B）：md/txt 两种，走同一条捕获管线。 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "请求体不是合法的 multipart/form-data" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  const headField = formData.get("head");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "缺少文件（form field 名须为 file）" },
      { status: 400 },
    );
  }
  if (!ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
    return NextResponse.json(
      { error: `只支持 ${ALLOWED_EXTENSIONS.join(" / ")} 文件` },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "文件超过 1MB 上限" }, { status: 400 });
  }

  const rawText = await file.text();
  if (!rawText.trim()) {
    return NextResponse.json({ error: "文件内容为空" }, { status: 400 });
  }

  const jobId = await enqueueCapture({
    projectId: DEFAULT_PROJECT_ID,
    channel: "file",
    head: headField === "meeting" ? "meeting" : undefined,
    rawText,
  });

  return NextResponse.json({ jobId }, { status: 202 });
}
