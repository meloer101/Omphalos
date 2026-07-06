import { describe, it, expect } from "vitest";
import { tryRepairJson } from "../runtime";

/**
 * P1 出口验收（粘贴 20 条反馈）实测踩到的真实 bug：deepseek-v4-pro 生成
 * tool-call 参数时，字符串字段里出现未转义的引号（中文反馈原文自带引号
 * 是家常便饭，如 `建议加一个"最近使用"的快捷入口`），导致 JSON 语法损坏，
 * `ai` 包内置解析失败后把原始字符串原样透传，zod 校验报
 * "expected object, received string"，整批捕获失败。
 * 这组用例锁住 tryRepairJson 的兜底行为，不回归。
 */
describe("tryRepairJson：修复模型输出里常见的 JSON 语法错误", () => {
  it("字符串字段内出现未转义引号时能修复并解析出正确内容", () => {
    const broken =
      '{"items":[{"title":"建议增加"最近使用"快捷入口","confidence":0.9}]}';
    const result = tryRepairJson(broken) as {
      items: { title: string; confidence: number }[];
    };
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('建议增加"最近使用"快捷入口');
  });

  it("本来就合法的 JSON 原样解析，不受影响", () => {
    const valid = '{"items":[{"title":"正常标题","confidence":0.5}]}';
    expect(tryRepairJson(valid)).toEqual({
      items: [{ title: "正常标题", confidence: 0.5 }],
    });
  });

  it("修不好的输入原样返回字符串，交给上层 zod 报出清楚的错误", () => {
    const unfixable = "这根本不是 JSON，也不是任何合法结构###";
    expect(tryRepairJson(unfixable)).toBe(unfixable);
  });
});
