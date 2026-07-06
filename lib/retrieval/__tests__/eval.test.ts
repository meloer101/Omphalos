import { describe, it, expect } from "vitest";
import {
  EVAL_QUESTIONS,
  SEED_NODES,
  SEED_EDGES,
} from "./eval.fixtures";
import { assignHandles, parseCitedAnswer } from "../cite";
import type { ReachableNode } from "../traverse";

/**
 * 检索评估集 v1 的 CI 层（Phase2-开工计划.md 2.2）。这一层**不碰真模型**，
 * 只做两件确定性的事：坐实评估集自洽，以及把引用护栏跑遍整个评估集——
 * "错误引用 0 容忍"是靠护栏结构性成立的，不是靠模型答得好。
 * live 端到端层见文件末尾（默认跳过，需真库 + 真模型）。
 */

const answerable = EVAL_QUESTIONS.filter((q) => q.mode === "answer");
const refusable = EVAL_QUESTIONS.filter((q) => q.mode === "refuse");
const seedIds = new Set(SEED_NODES.map((n) => n.handle));

describe("评估集自洽", () => {
  it("至少 20 个问答对，其中至少 5 个应拒答", () => {
    expect(EVAL_QUESTIONS.length).toBeGreaterThanOrEqual(20);
    expect(refusable.length).toBeGreaterThanOrEqual(5);
  });

  it("每个 answer 用例的期望引用都指向真实种子节点", () => {
    for (const q of answerable) {
      expect(q.expectAnyOf, q.q).toBeTruthy();
      for (const h of q.expectAnyOf!) {
        expect(seedIds.has(h), `${q.q} → ${h}`).toBe(true);
      }
    }
  });

  it("每条种子边的两端都是真实种子节点", () => {
    for (const e of SEED_EDGES) {
      expect(seedIds.has(e.src), `${e.type} src ${e.src}`).toBe(true);
      expect(seedIds.has(e.dst), `${e.type} dst ${e.dst}`).toBe(true);
    }
  });
});

describe("引用护栏跑遍评估集：合法引用留、幻觉引用剥离（0 容忍）", () => {
  // 把种子节点当作某次遍历的可达集合（id 直接用 seed handle）。
  const reachable: ReachableNode[] = SEED_NODES.map((n) => ({
    id: n.handle,
    type: n.type,
    title: n.title,
    excerpt: n.bodyText,
  }));
  const handles = assignHandles(reachable);
  const runtimeHandleById = new Map(
    [...handles.values()].map((s) => [s.id, s.handle]),
  );

  it("对每个 answer 用例：合成一段引用了期望节点 + 一个幻觉句柄的答案，护栏保真剥假", () => {
    for (const q of answerable) {
      const expected = q.expectAnyOf!;
      const cited = expected.map((h) => `[${runtimeHandleById.get(h)}]`).join("");
      // 故意掺一个绝不存在的句柄，模拟模型幻觉。
      const synthetic = `根据图里的记录可以回答。${cited}另外这里是编造的来源[Z9]。`;

      const { citations, strippedHandles } = parseCitedAnswer(synthetic, handles);

      // 幻觉句柄必被剥离。
      expect(strippedHandles, q.q).toContain("Z9");
      // 合法引用全部落在种子节点内，一个越界的都没有。
      for (const c of citations) {
        expect(seedIds.has(c.id), `${q.q} 引用越界 ${c.id}`).toBe(true);
      }
      // 期望的节点确实被引用到了。
      const citedIds = new Set(citations.map((c) => c.id));
      expect(expected.some((h) => citedIds.has(h)), q.q).toBe(true);
    }
  });
});

/**
 * live 端到端层：默认跳过，本地/nightly 起真库 + 真模型时打开
 * （RUN_RETRIEVAL_EVAL=1），验证真实回答的引用全部落在种子节点内、
 * 应拒答用例返回 no_record。放这里占位，实现随 2.3 出口验收补齐。
 */
describe.skipIf(!process.env.RUN_RETRIEVAL_EVAL)(
  "live 端到端（需真库 + 真模型）",
  () => {
    it("待实现：seedEvalGraph → embedNodes → answerQuestion 逐题断言", () => {
      expect(true).toBe(true);
    });
  },
);
