import { config } from "dotenv";
config({ path: ".env.local" });

import { generateText, tool } from "ai";
import { z } from "zod";
import { getDefaultModel } from "./client";

/**
 * Phase0-开工计划.md 0.4：不写业务 Agent，只验证
 * "AI SDK → LiteLLM → DeepSeek 结构化输出"这条命脉稳不稳。
 * 手动运行：npx tsx lib/ai/spike-stress-test.ts
 * （不叫 *.test.ts，故意不让 vitest/CI 捡到——这个脚本真的会
 * 打模型 API、花真钱，只应该在这次 spike 手动跑一次。）
 *
 * 踩过的坑（写进 Phase0-开工计划.md 风险登记）：
 * - `generateObject`/`Output.object()` 的 response_format 路径：
 *   deepseek-v4-pro 拒绝 `json_schema` 类型的 response_format
 *   （"This response_format type is unavailable now"）；不开
 *   supportsStructuredOutputs 则退化成裸 json_object，模型完全不认
 *   我们传的 schema，自己瞎编形状。
 * - 强制 tool_choice（指定具体工具或 'required'）：deepseek-v4-pro
 *   是"思考模式"（reasoning）模型，报错"Thinking mode does not
 *   support this tool_choice"。
 * - 最终方案：tool-calling + `toolChoice: 'auto'` + prompt 里明确要求
 *   调用工具。这是本次验证下来对这个模型唯一稳定工作的结构化输出策略，
 *   P1 捕获 Agent 应该照此搭建，而不是指望 response_format 或强制
 *   tool_choice。
 */

// 镜像 P1 捕获 Agent 实际要做的事：从一段粘贴的原始反馈里
// 抽取结构化证据条目，输出 shape 与 lib/graph.createNode 的
// 输入直接对应（title + body text + confidence）。
const extractionSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().describe("一句话标题，概括这条反馈"),
        bodyText: z.string().describe("反馈原文摘录或复述"),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .describe("这条抽取结果的把握程度"),
      }),
    )
    .describe("从原始输入中抽取出的独立反馈条目列表"),
});

const SAMPLE_FEEDBACK = `
1. 用户在 App Store 评论："结算的时候只能用支付宝，能不能加个微信支付啊，
   我手机里根本没装支付宝"
2. 客服工单 #4821："客户反馈多次尝试用微信扫码支付未果，最终放弃购买"
3. 销售访谈记录（企业客户 A）："我们财务对账系统只对接了微信支付的账单接口，
   希望能支持"
4. Slack #product-feedback 频道留言："+1 微信支付，身边好多朋友因为这个
   不用支付宝"
5. NPS 调研自由填空题回答："其他都挺好，就是支付方式太少了，加个微信支付
   就完美了"
`;

const PROMPT = `你是一个产品反馈结构化助手。从下面的原始反馈文本中，抽取出独立的
反馈条目，必须调用 extract_evidence 工具提交结果，不要只用文字回答。
每条给出简短标题、原文摘录、以及你对这条抽取结果的置信度。

原始反馈：
${SAMPLE_FEEDBACK}`;

interface RunResult {
  ok: boolean;
  latencyMs: number;
  itemCount?: number;
  error?: string;
}

async function runOnce(): Promise<RunResult> {
  const start = Date.now();
  try {
    const result = await generateText({
      model: getDefaultModel(),
      tools: {
        extract_evidence: tool({
          description: "把从反馈文本中抽取出的结构化证据条目提交给系统",
          inputSchema: extractionSchema,
        }),
      },
      toolChoice: "auto",
      prompt: PROMPT,
    });

    const call = result.toolCalls.find(
      (c) => c.toolName === "extract_evidence",
    );
    if (!call) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: "模型没有调用 extract_evidence 工具（只回了文字）",
      };
    }
    const parsed = extractionSchema.safeParse(call.input);
    if (!parsed.success) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `工具入参不匹配 schema: ${parsed.error.message}`,
      };
    }
    return {
      ok: true,
      latencyMs: Date.now() - start,
      itemCount: parsed.data.items.length,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const RUNS = 20;
  const results: RunResult[] = [];

  console.log(
    `跑 ${RUNS} 次 tool-calling 结构化抽取，模型: default (deepseek-v4-pro via LiteLLM)...`,
  );

  for (let i = 0; i < RUNS; i++) {
    const r = await runOnce();
    results.push(r);
    process.stdout.write(
      r.ok ? `✓ (${r.latencyMs}ms, ${r.itemCount} items)\n` : `✗ ${r.error}\n`,
    );
  }

  const successes = results.filter((r) => r.ok);
  const failures = results.filter((r) => !r.ok);
  const avgLatency =
    successes.reduce((sum, r) => sum + r.latencyMs, 0) /
    (successes.length || 1);
  const successRate = (successes.length / RUNS) * 100;

  console.log("\n--- 压测结论 ---");
  console.log(`成功率: ${successRate.toFixed(1)}% (${successes.length}/${RUNS})`);
  console.log(`平均延迟（成功请求）: ${avgLatency.toFixed(0)}ms`);
  if (failures.length > 0) {
    console.log(`失败原因样本: ${failures[0].error}`);
  }
  console.log(
    successRate >= 90
      ? "\n达标（>=90%）：P1 捕获 Agent 可按 tool-calling + toolChoice:'auto' 这条链路搭建。"
      : "\n不达标（<90%）：需评估换模型（改 litellm/config.yaml 一行）或加重试层。",
  );

  process.exit(successRate >= 90 ? 0 : 1);
}

main();
