import { describe, it, expect } from "vitest";
import { nodeEmbeddingText } from "../index";

/**
 * 语义索引的文本抽取（Phase2-开工计划.md 2.1）。锁住三种 body 形状的
 * 拍平行为——向量质量直接决定追溯检索能不能找对入口节点，抽错文本
 * 等于埋幻觉入口，这组用例是它的第一道防线。
 */
describe("nodeEmbeddingText：把 title + body 拍平成可嵌入文本", () => {
  it("evidence 节点：title + body.text", () => {
    const text = nodeEmbeddingText({
      title: "用户想要微信支付",
      body: { text: "结算页只有支付宝，好几个客户问能不能微信付" },
    });
    expect(text).toContain("用户想要微信支付");
    expect(text).toContain("好几个客户问能不能微信付");
  });

  it("feature/task 节点：抽取 BlockNote blocks 的纯文本（含行内与嵌套）", () => {
    const text = nodeEmbeddingText({
      title: "结算页改版",
      body: {
        blocks: [
          { type: "heading", content: [{ type: "text", text: "背景" }] },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "推迟微信支付，" },
              { type: "text", text: "因为合规未过" },
            ],
            children: [
              { type: "paragraph", content: [{ type: "text", text: "十月复盘决定" }] },
            ],
          },
        ],
      },
    });
    expect(text).toContain("结算页改版");
    expect(text).toContain("背景");
    expect(text).toContain("推迟微信支付，因为合规未过");
    expect(text).toContain("十月复盘决定");
  });

  it("content 直接是字符串的块也能抽出来", () => {
    const text = nodeEmbeddingText({
      title: "T",
      body: { blocks: [{ type: "paragraph", content: "纯字符串内容" }] },
    });
    expect(text).toContain("纯字符串内容");
  });

  it("outcome 节点：metric + value + note", () => {
    const text = nodeEmbeddingText({
      title: "支付转化率",
      body: { metric: "checkout_conversion", value: "+12%", note: "上线两周后" },
    });
    expect(text).toContain("checkout_conversion");
    expect(text).toContain("+12%");
    expect(text).toContain("上线两周后");
  });

  it("空/未知 body 退化为只用 title，不塞结构化 JSON 污染向量", () => {
    expect(nodeEmbeddingText({ title: "只有标题", body: {} })).toBe("只有标题");
    expect(
      nodeEmbeddingText({ title: "怪形状", body: { weird: { nested: 1 } } }),
    ).toBe("怪形状");
  });
});
