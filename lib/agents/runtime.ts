import { generateText, tool } from "ai";
import { jsonrepair } from "jsonrepair";
import { getDefaultModel } from "@/lib/ai/client";
import type { AgentContract } from "./contract";

/**
 * 运行时执行器（Agent架构设计.md 5.2/5.3）：图事件触发 → 上下文装配 →
 * LLM 调用 → zod 校验 → 写提议态节点/边。四份合同共用这一条流水线，
 * 差异全部封装在 contract 里（Phase1-开工计划.md 决策 D）。
 *
 * 结构化输出策略锁定为 tool-calling + toolChoice:'auto'——`generateObject`
 * /`Output.object()` 与强制 `tool_choice` 在 deepseek-v4-pro 上都是死路，
 * 已在 Phase0-开工计划.md 0.4 压测验证（20/20 成功率）。
 *
 * 重试/死信不在这里手动实现：pg-boss 队列级的 retryLimit + deadLetter
 * （lib/queue/boss.ts）已经就是这件事该用的机制——runPipeline 只管一次
 * 尝试，失败就抛错，交给调用方（worker 的 job handler，进而是 pg-boss）
 * 处理重试与死信路由。
 */

const TOOL_NAME = "submit_structured_output";

export interface PipelineResult<TOutput> {
  output: TOutput;
  nodeIds: string[];
  edgeIds: string[];
}

export class PipelineOutputError extends Error {
  constructor(contractName: string, cause: unknown) {
    super(`${contractName} 合同：模型输出未通过校验`, { cause });
    this.name = "PipelineOutputError";
  }
}

export async function runPipeline<TInput, TOutput>(
  contract: AgentContract<TInput, TOutput>,
  input: TInput,
): Promise<PipelineResult<TOutput>> {
  const ctx = await contract.assembleContext(input);
  const { system, prompt } = contract.buildPrompt(input, ctx);

  const result = await generateText({
    model: getDefaultModel(),
    system,
    tools: {
      [TOOL_NAME]: tool({
        description: `提交 ${contract.name} 合同要求的结构化输出`,
        inputSchema: contract.outputSchema,
      }),
    },
    toolChoice: "auto",
    prompt,
  });

  const call = result.toolCalls.find((c) => c.toolName === TOOL_NAME);
  if (!call) {
    throw new PipelineOutputError(
      contract.name,
      new Error(
        "模型没有调用工具（只回了文字）——见 Phase0-开工计划.md 0.4：" +
          "deepseek-v4-pro 靠 prompt 明确要求调用工具才稳定，检查 buildPrompt 措辞",
      ),
    );
  }

  // call.input 正常应已是解析好的对象；但当模型吐出的 JSON 语法有误时
  // （最常见：字符串字段里出现未转义的引号——中文反馈原文自带引号是家常
  // 便饭），`ai` 包内置的 JSON.parse 会失败并把原始字符串原样透传出来，
  // 此时 call.input 的类型是 string 而非 object。用 jsonrepair 兜底修复
  // 这类语法错误后再走一次 zod 校验，救回原本会整批失败的捕获结果。
  const rawInput =
    typeof call.input === "string" ? tryRepairJson(call.input) : call.input;

  const parsed = contract.outputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new PipelineOutputError(contract.name, parsed.error);
  }

  const { nodeIds, edgeIds } = await contract.applyOutput(
    input,
    ctx,
    parsed.data,
  );
  return { output: parsed.data, nodeIds, edgeIds };
}

/** 语法有误就试着修，修不好原样返回（后面 zod 校验会给出清楚的错误）。 */
export function tryRepairJson(raw: string): unknown {
  try {
    return JSON.parse(jsonrepair(raw));
  } catch {
    return raw;
  }
}
