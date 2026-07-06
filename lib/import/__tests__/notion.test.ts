import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { parseNotionExport, cleanNotionTitle } from "../notion";

/**
 * Notion 导出包解析（Phase2-开工计划.md 2.3）。锁住"解包 → 一份文档一条
 * ImportDoc"的确定性行为——解析错了会把脏标题/空文档喂进 import 合同，
 * 污染冷启动。
 */

describe("cleanNotionTitle：剥掉文件名尾部的页面 id", () => {
  it("去掉 32 位 hex 页面 id 与扩展名", () => {
    expect(
      cleanNotionTitle("结算页支付方式 a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4.md"),
    ).toBe("结算页支付方式");
  });

  it("带路径的文件名只取 basename", () => {
    expect(cleanNotionTitle("Export/子页面/登录改版 ".concat("f".repeat(32), ".md"))).toBe(
      "登录改版",
    );
  });

  it("没有 id 尾巴的普通文件名原样保留", () => {
    expect(cleanNotionTitle("notes.md")).toBe("notes");
  });
});

describe("parseNotionExport：解 zip 成多份文档", () => {
  function makeZip(files: Record<string, string>): Buffer {
    const zip = new AdmZip();
    for (const [name, content] of Object.entries(files)) {
      zip.addFile(name, Buffer.from(content, "utf8"));
    }
    return zip.toBuffer();
  }

  it("每个 .md 变一条文档，标题去 id、正文保留", () => {
    const buffer = makeZip({
      [`结算页支付方式 ${"a".repeat(32)}.md`]: "# 结算页\n推迟微信支付，因为合规未过。",
      [`空页 ${"b".repeat(32)}.md`]: "   ",
    });
    const docs = parseNotionExport(buffer);
    expect(docs).toHaveLength(1); // 空正文被丢弃
    expect(docs[0].title).toBe("结算页支付方式");
    expect(docs[0].text).toContain("推迟微信支付");
    expect(docs[0].source).toBe("notion");
  });

  it("CSV 转成逐行「表头: 值」文本", () => {
    const buffer = makeZip({
      [`需求表 ${"c".repeat(32)}.csv`]: "名称,状态\n微信支付,推迟\n支付宝,已上线",
    });
    const docs = parseNotionExport(buffer);
    expect(docs).toHaveLength(1);
    expect(docs[0].text).toContain("名称: 微信支付；状态: 推迟");
    expect(docs[0].text).toContain("名称: 支付宝；状态: 已上线");
  });

  it("忽略非 md/csv 文件（图片等附件）", () => {
    const buffer = makeZip({
      [`页面 ${"d".repeat(32)}.md`]: "正文",
      "image.png": "\x89PNG binary",
    });
    const docs = parseNotionExport(buffer);
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe("页面");
  });
});
