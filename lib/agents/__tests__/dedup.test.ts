import { describe, it, expect } from "vitest";
import { findLikelyDuplicate } from "../dedup";

/**
 * 阈值校准记录（Phase1-开工计划.md 1.2）：真重复对得分 0.25~0.44，
 * 真不重复对得分 0.00~0.10，0.2 落在两者中间偏安全一侧——这组用例
 * 就是校准时用的样本，锁住行为不回归。
 */
describe("findLikelyDuplicate：title 粗匹配（字符二元组 Jaccard）", () => {
  const candidates = [
    { id: "a", title: "用户希望结算页支持微信支付" },
    { id: "b", title: "客服反馈客户微信支付失败放弃购买" },
    { id: "c", title: "首页加载很慢" },
  ];

  it("命中真正的重复表达", () => {
    const match = findLikelyDuplicate(
      "用户反馈结算仅支持支付宝，希望增加微信支付",
      candidates,
    );
    expect(match?.id).toBe("a");
  });

  it("不误判不相关的标题", () => {
    const match = findLikelyDuplicate("用户想要暗色模式", candidates);
    expect(match).toBeUndefined();
  });

  it("候选列表为空时不报错、返回 undefined", () => {
    expect(findLikelyDuplicate("任意标题", [])).toBeUndefined();
  });

  it("多个候选命中时返回相似度最高的那个", () => {
    const match = findLikelyDuplicate("客户微信支付失败放弃购买", candidates);
    expect(match?.id).toBe("b");
  });
});
