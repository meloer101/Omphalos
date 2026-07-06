import type { NodeType, EdgeType } from "@/db/enums";

/**
 * 检索评估集 v1（Phase2-开工计划.md 2.2，PRD R4 验收）。一张确定性种子图
 * ——围绕"结算页当初为什么不做微信支付"这条真实感的因果链——加 ≥20 个
 * 问答对（含 ≥5 个"应拒答"）。
 *
 * 两种消费方式：
 *  - CI 确定性层（eval.test.ts，无需真模型/真库）：校验评估集自洽 + 用合成
 *    答案跑引用护栏，坐实"错误引用 0 容忍"覆盖到每个用例。
 *  - live 端到端层（gated，需真库 + 真 embedding/生成模型）：seedEvalGraph
 *    熔图后跑 answerQuestion，断言引用 ⊆ 种子节点、应拒答用例返回 no_record。
 */

export interface SeedNodeSpec {
  handle: string; // 评估集内部引用用，不是 cite.ts 的运行时句柄
  type: NodeType;
  title: string;
  bodyText: string;
}

export interface SeedEdgeSpec {
  type: EdgeType;
  src: string; // handle
  dst: string; // handle
}

export const SEED_NODES: SeedNodeSpec[] = [
  {
    handle: "F_pay",
    type: "feature",
    title: "结算页支付方式",
    bodyText:
      "结算页支付方式改版：决定 Q4 先接支付宝，推迟微信支付。推迟的原因是合规审查未通过、研发排期已满。",
  },
  {
    handle: "E_want",
    type: "evidence",
    title: "多位客户要求微信支付",
    bodyText: "十几位客户在反馈里提到结算只支持支付宝，希望增加微信支付。",
  },
  {
    handle: "E_compliance",
    type: "evidence",
    title: "微信支付合规审查未通过",
    bodyText: "十月的合规审查结论：微信支付资质材料不齐，本季度无法过审。",
  },
  {
    handle: "E_schedule",
    type: "evidence",
    title: "Q4 研发排期已满",
    bodyText: "Q4 研发排期已被结算重构和风控占满，无余量接第二个支付渠道。",
  },
  {
    handle: "T_alipay",
    type: "task",
    title: "接入支付宝",
    bodyText: "对接支付宝网关，完成结算页支付方式的第一个渠道。",
  },
  {
    handle: "O_conv",
    type: "outcome",
    title: "支付转化率 +12%",
    bodyText: "结算页支付方式上线两周后，支付转化率相比改版前提升 12%。",
  },
];

export const SEED_EDGES: SeedEdgeSpec[] = [
  { type: "supports", src: "E_want", dst: "F_pay" }, // 客户需求支撑该需求
  { type: "because", src: "F_pay", dst: "E_compliance" }, // 推迟 because 合规
  { type: "because", src: "F_pay", dst: "E_schedule" }, // 推迟 because 排期
  { type: "implements", src: "T_alipay", dst: "F_pay" }, // 支付宝任务实现该需求
  { type: "validates", src: "O_conv", dst: "F_pay" }, // 结果验证该需求
];

export type EvalMode = "answer" | "refuse";

export interface EvalQuestion {
  q: string;
  mode: EvalMode;
  /** answer 模式下，期望回答里至少引用到这些种子节点（handle）之一。 */
  expectAnyOf?: string[];
}

export const EVAL_QUESTIONS: EvalQuestion[] = [
  { q: "结算页当初为什么不做微信支付？", mode: "answer", expectAnyOf: ["E_compliance", "E_schedule", "F_pay"] },
  { q: "微信支付为什么被推迟了？", mode: "answer", expectAnyOf: ["E_compliance", "E_schedule"] },
  { q: "合规和微信支付有什么关系？", mode: "answer", expectAnyOf: ["E_compliance"] },
  { q: "研发排期影响了哪个支付决策？", mode: "answer", expectAnyOf: ["E_schedule", "F_pay"] },
  { q: "有哪些客户证据支撑结算页支付方式？", mode: "answer", expectAnyOf: ["E_want"] },
  { q: "结算页支付方式上线后效果怎么样？", mode: "answer", expectAnyOf: ["O_conv"] },
  { q: "谁在实现结算页支付方式？", mode: "answer", expectAnyOf: ["T_alipay"] },
  { q: "支付转化率提升了多少？", mode: "answer", expectAnyOf: ["O_conv"] },
  { q: "为什么 Q4 先接的是支付宝？", mode: "answer", expectAnyOf: ["F_pay", "E_schedule", "T_alipay"] },
  { q: "客户对结算页支付方式有什么反馈？", mode: "answer", expectAnyOf: ["E_want"] },
  { q: "十月那次合规审查的结论是什么？", mode: "answer", expectAnyOf: ["E_compliance"] },
  { q: "结算页支付方式被验证了吗？", mode: "answer", expectAnyOf: ["O_conv"] },
  { q: "微信支付上线的阻碍是什么？", mode: "answer", expectAnyOf: ["E_compliance", "E_schedule"] },
  { q: "支付方式改版关联了哪些用户证据？", mode: "answer", expectAnyOf: ["E_want"] },
  { q: "接入支付宝这张任务卡是为哪个需求做的？", mode: "answer", expectAnyOf: ["F_pay", "T_alipay"] },

  // —— 应拒答（图里没有的内容，答"图里没有记录"，不推测）——
  { q: "暗色模式什么时候上线？", mode: "refuse" },
  { q: "为什么砍掉了全局搜索功能？", mode: "refuse" },
  { q: "登录页改版的计划是什么？", mode: "refuse" },
  { q: "团队现在用什么持续集成工具？", mode: "refuse" },
  { q: "首页加载慢的问题解决了吗？", mode: "refuse" },
  { q: "移动端适配做到什么程度了？", mode: "refuse" },
];
