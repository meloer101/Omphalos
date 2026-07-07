import { describe, it, expect } from "vitest";
import { assignHandles, buildSourceList, parseCitedAnswer } from "../cite";
import type { ReachableNode } from "../traverse";

/**
 * 引用护栏（Phase2-开工计划.md 决策 G）：这是"错误引用 0 容忍"在结构上
 * 成立的把关点，全程不碰 LLM，纯确定性。任一用例挂 = 追溯有幻觉引用
 * 溜到用户眼前的风险，必须视为发版阻塞（Roadmap 风险登记：检索幻觉）。
 */

const NODES: ReachableNode[] = [
  { id: "id-ev-1", type: "evidence", title: "客户要微信支付", excerpt: "多个客户反馈" },
  { id: "id-ev-2", type: "evidence", title: "合规未过备忘", excerpt: "十月合规结论" },
  { id: "id-ft-1", type: "feature", title: "结算页支付方式", excerpt: "推迟微信支付" },
];

describe("assignHandles：按类型前缀 + 序号分配稳定句柄", () => {
  it("同类型递增编号，不同类型各自前缀", () => {
    const map = assignHandles(NODES);
    const byId = new Map([...map.values()].map((s) => [s.id, s.handle]));
    expect(byId.get("id-ev-1")).toBe("E1");
    expect(byId.get("id-ev-2")).toBe("E2");
    expect(byId.get("id-ft-1")).toBe("F1");
  });
});

describe("buildSourceList：喂给 prompt 的可引用清单只含句柄，不含裸 UUID", () => {
  it("每个节点一行，带句柄、类型、标题、摘要", () => {
    const map = assignHandles(NODES);
    const list = buildSourceList(NODES, map);
    expect(list).toContain("[E1]");
    expect(list).toContain("结算页支付方式");
    // 关键：清单里不该出现真实 id，模型无从照抄一个"看起来对"的深链。
    expect(list).not.toContain("id-ev-1");
  });
});

describe("parseCitedAnswer：合法引用变深链，非法句柄就地剥离", () => {
  it("合法句柄映射成 cite 分段，携带真实 id/标题/类型", () => {
    const map = assignHandles(NODES);
    const { segments, citations, strippedHandles } = parseCitedAnswer(
      "当时推迟了微信支付[F1]，因为合规没过[E2]。",
      map,
    );
    expect(strippedHandles).toEqual([]);
    const cites = segments.filter((s) => s.kind === "cite");
    expect(cites).toHaveLength(2);
    expect(citations.map((c) => c.id).sort()).toEqual(["id-ev-2", "id-ft-1"]);
    expect(segments[0]).toEqual({ kind: "text", text: "当时推迟了微信支付" });
  });

  it("幻觉句柄（不在映射表里）被完全剥离，不留标记在答案里", () => {
    const map = assignHandles(NODES);
    const { segments, citations, strippedHandles } = parseCitedAnswer(
      "有个不存在的来源[E9]，还有真的[E1]。",
      map,
    );
    expect(strippedHandles).toEqual(["E9"]);
    expect(citations.map((c) => c.id)).toEqual(["id-ev-1"]);
    // 剥离后答案里不该再出现 [E9] 字样。
    const rendered = segments
      .map((s) => (s.kind === "text" ? s.text : `<${s.title}>`))
      .join("");
    expect(rendered).not.toContain("E9");
    expect(rendered).not.toContain("[");
  });

  it("大小写不敏感：模型偶尔吐小写句柄也能对上", () => {
    const map = assignHandles(NODES);
    const { citations } = parseCitedAnswer("小写[f1]也算数。", map);
    expect(citations.map((c) => c.id)).toEqual(["id-ft-1"]);
  });

  it("同一节点被引用多次，citations 去重但分段各自保留", () => {
    const map = assignHandles(NODES);
    const { segments, citations } = parseCitedAnswer("[E1]又一次[E1]。", map);
    expect(citations).toHaveLength(1);
    expect(segments.filter((s) => s.kind === "cite")).toHaveLength(2);
  });

  it("完全没有引用标记时，整段就是一段纯文本", () => {
    const map = assignHandles(NODES);
    const { segments, citations } = parseCitedAnswer("一句没有引用的话。", map);
    expect(citations).toEqual([]);
    expect(segments).toEqual([{ kind: "text", text: "一句没有引用的话。" }]);
  });
});
