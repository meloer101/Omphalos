import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { enqueueImport, type ImportSource } from "@/lib/agents/contracts/import";
import {
  parseNotionExport,
  cleanNotionTitle,
  type ImportDoc,
} from "@/lib/import/notion";
import { DEFAULT_PROJECT_ID } from "@/lib/config";

/**
 * 冷启动导入入口（Phase2-开工计划.md 2.3，PRD R7）。上传一个文件：
 *  - .zip  → 当作 Notion 导出包，解包成多份文档；
 *  - .md/.markdown/.txt → 一份 markdown 文档；
 *  - .csv  → 一份 csv 文档（逐行文本）。
 * 每份文档拆成一个 import job 入 pg-boss（worker 并发即并行熔图）；同一次
 * 上传共用一个 batchId，审批 tab 按批次把它们归到一组。结果走已有 SSE +
 * 审批全套落图，本路由只负责拆分入队，不碰模型。
 */

// 导入是"食物"入口，允许比捕获（1MB）大：一个 Notion 导出包可能不小。
const MAX_FILE_BYTES = 20_000_000;

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
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "缺少文件（form field 名须为 file）" },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "文件超过 20MB 上限" }, { status: 400 });
  }

  const name = file.name.toLowerCase();
  let docs: ImportDoc[];

  try {
    if (name.endsWith(".zip")) {
      const buffer = Buffer.from(await file.arrayBuffer());
      docs = parseNotionExport(buffer);
    } else if (/\.(md|markdown|txt)$/.test(name)) {
      const text = (await file.text()).trim();
      docs = text
        ? [{ title: cleanNotionTitle(file.name), text, source: "markdown" }]
        : [];
    } else if (name.endsWith(".csv")) {
      // 单个 CSV 也复用 Notion 解析里的逐行转换：包一层单文件 zip 太重，
      // 这里直接把整份 csv 当一份文档丢给 import 合同抽取。
      const text = (await file.text()).trim();
      docs = text
        ? [{ title: cleanNotionTitle(file.name), text, source: "csv" }]
        : [];
    } else {
      return NextResponse.json(
        { error: "只支持 .zip（Notion 导出）/ .md / .markdown / .txt / .csv" },
        { status: 400 },
      );
    }
  } catch (err) {
    console.error("[import] 解析上传失败:", err);
    return NextResponse.json({ error: "解析文件失败" }, { status: 400 });
  }

  if (docs.length === 0) {
    return NextResponse.json({ error: "文件里没有可导入的内容" }, { status: 400 });
  }

  // 同一次上传共用一个批次键——审批 tab 按批次分组时把整包归一组。
  const batchId = `import-${randomUUID()}`;
  const jobIds = await Promise.all(
    docs.map((doc) =>
      enqueueImport({
        projectId: DEFAULT_PROJECT_ID,
        source: doc.source as ImportSource,
        docTitle: doc.title,
        rawText: doc.text,
        batchId,
      }),
    ),
  );

  return NextResponse.json(
    { batchId, docCount: docs.length, jobIds },
    { status: 202 },
  );
}
