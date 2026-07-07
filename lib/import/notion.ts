import AdmZip from "adm-zip";

/**
 * Notion 导出包解析（Phase2-开工计划.md 2.3，PRD R7）。Notion 的
 * "Export → Markdown & CSV" 产出一个 zip：每个页面一个 .md 文件
 * （文件名尾部带一段 32 位 hex 的页面 id），数据库导出成 .csv，子页面
 * 放在同名文件夹里。
 *
 * 这里只做"解包 → 一份文档一条 ImportDoc"的确定性活，不调模型——熔成
 * 节点/边是 import 合同的事（lib/agents/contracts/import.ts）。每条
 * ImportDoc 之后会被 app/api/import 拆成一个 pg-boss job 并行导入。
 */

export interface ImportDoc {
  title: string;
  text: string;
  source: "markdown" | "csv" | "notion";
}

/** 去掉 Notion 文件名尾部的 " <32位hex>" 页面 id，还原可读标题。 */
export function cleanNotionTitle(fileName: string): string {
  const base = fileName.replace(/\.(md|csv)$/i, "");
  const noPath = base.split("/").pop() ?? base;
  return noPath.replace(/\s+[0-9a-f]{32}$/i, "").trim() || noPath;
}

/** 把一张 CSV 表转成逐行的纯文本（表头: 值），供模型抽取。 */
function csvToText(csv: string): string {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return "";
  const header = splitCsvLine(lines[0]);
  return lines
    .slice(1)
    .map((line) => {
      const cells = splitCsvLine(line);
      return header.map((h, i) => `${h}: ${cells[i] ?? ""}`).join("；");
    })
    .join("\n");
}

/** 极简 CSV 拆行：处理双引号包裹与转义引号，足够 Notion 导出用。 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/**
 * 解析 Notion 导出 zip。每个 .md → 一条文档；每个 .csv → 一条文档
 * （转成逐行文本）。正文为空的条目丢弃。
 */
export function parseNotionExport(buffer: Buffer): ImportDoc[] {
  const zip = new AdmZip(buffer);
  const docs: ImportDoc[] = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    const isMd = /\.md$/i.test(name);
    const isCsv = /\.csv$/i.test(name);
    if (!isMd && !isCsv) continue;

    const raw = entry.getData().toString("utf8");
    const text = isCsv ? csvToText(raw) : raw.trim();
    if (!text) continue;

    docs.push({
      title: cleanNotionTitle(name),
      text,
      source: "notion",
    });
  }

  return docs;
}
