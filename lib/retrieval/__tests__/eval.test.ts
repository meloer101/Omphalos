import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  EVAL_QUESTIONS,
  SEED_NODES,
  SEED_EDGES,
  seedEvalGraph,
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
 * （`RUN_RETRIEVAL_EVAL=1 pnpm vitest run lib/retrieval/__tests__/eval`）。
 * 前置：Supabase 起着、LiteLLM 的 embedding（本地 bge-m3）+ fast 模型可用。
 *
 * 断言分两层：
 *  - 硬不变量（所有用例）：回答里出现的每一个引用都必须落在种子节点内——
 *    错误引用 0 容忍。护栏在 cite.ts 已结构性保证，这里在真实模型输出上
 *    再验一遍，作为发版前的活体体检（Roadmap 风险登记：检索幻觉→停发版）。
 *  - answer 用例：不该误拒（返回 answer 且至少引用到一个期望节点）。
 *  - refuse 用例：不该硬凑（no_record，或答案里零引用/明说"图里没有记录"）。
 *
 * 会重置并占用 dev 库（同 db/__tests__ 惯例）。逐题一个真实模型往返，故给
 * 足超时。
 */
const RUN_LIVE = !!process.env.RUN_RETRIEVAL_EVAL;

describe.skipIf(!RUN_LIVE)("live 端到端（需真库 + 真模型）", () => {
  const PROJECT = "00000000-0000-0000-0000-000000000001";
  let seedHandleToId: Map<string, string>;
  let seededIds: Set<string>;

  beforeAll(async () => {
    // 动态 import：这些模块碰真库/真模型，只在 live 层加载，别拖累 CI 常跑层。
    const { resetGraph } = await import("@/db/__tests__/test-helpers");
    const { embedNodes } = await import("@/lib/embed");
    await resetGraph();
    seedHandleToId = await seedEvalGraph(PROJECT);
    seededIds = new Set(seedHandleToId.values());
    await embedNodes([...seededIds]); // 种子节点得有向量才被 semanticSearch 找到
  }, 120_000);

  afterAll(async () => {
    const { resetGraph } = await import("@/db/__tests__/test-helpers");
    await resetGraph();
  });

  it.each(EVAL_QUESTIONS.map((q) => [q.q, q] as const))(
    "「%s」",
    async (_label, question) => {
      const { answerQuestion } = await import("../answer");
      const result = await answerQuestion(question.q, PROJECT);

      if (result.kind === "no_record") {
        // 拒答是所有 refuse 用例的理想结局；answer 用例走到这里就是误拒。
        expect(question.mode, `answer 用例被误拒: ${question.q}`).toBe("refuse");
        return;
      }

      let raw = "";
      for await (const delta of result.textStream) raw += delta;
      const map = new Map(result.sources.map((s) => [s.handle, s]));
      const { citations } = parseCitedAnswer(raw, map);

      // 硬不变量：0 错误引用——每个引用都指向种子里的真实节点。
      for (const c of citations) {
        expect(seededIds.has(c.id), `越界引用 ${c.id}（${question.q}）`).toBe(true);
      }

      if (question.mode === "answer") {
        const expectedIds = new Set(
          (question.expectAnyOf ?? []).map((h) => seedHandleToId.get(h)),
        );
        expect(
          citations.some((c) => expectedIds.has(c.id)),
          `没引用到期望节点: ${question.q}`,
        ).toBe(true);
      } else {
        // refuse 用例即便走了生成，也不该编造事实引用——零引用或明说没记录。
        const refused = citations.length === 0 || raw.includes("图里没有记录");
        expect(refused, `refuse 用例硬凑了带引用的回答: ${question.q}`).toBe(true);
      }
    },
    60_000,
  );
});
