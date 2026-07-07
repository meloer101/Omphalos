import type { z } from "zod";

/**
 * 合同抽象（Agent架构设计.md 5.2/5.3）：代码层面只有一个 agent 运行时，
 * 跑四套配置。"四个 Agent"分的不是程序，是四份合同——一个演员演四个
 * 角色，剧本和戏路分开写。P1 只实现 capture 一份（lib/agents/contracts/
 * capture.ts）；retrieval/advance/judgment 先在这里立类型，P2+ 再填。
 */
export type ContractName =
  | "capture"
  | "retrieval"
  | "advance"
  | "judgment"
  // import 是 capture 的冷启动变体（PRD R7"导入经捕获 Agent 熔成原生节点"），
  // 但输出 schema 更宽（新建 feature + because 边），单列一份合同（决策 H）。
  | "import";

/**
 * 上下文装配的产出——Agent 被唤醒时查图得到的邻域快照
 * （Agent架构设计.md 5.1"记忆是每次查出来的，不是存在 Agent 里的"）。
 * P1 的候选节点是全量+关键词粗匹配（无向量检索）；P2 检索合同接入向量
 * 入口后，装配函数会替换掉这一步，合同的接口不用变。
 */
export interface AssembledContext {
  projectId: string;
  candidateNodes: Array<{ id: string; type: string; title: string }>;
}

export interface PromptSpec {
  system?: string;
  prompt: string;
}

/**
 * 权限边界（Agent架构设计.md 5.2 的合同表）：
 * - read: 'local' 局部（当前 project）| 'global' 跨 project | 'none'
 * - write: 'proposal' 只能写提议态 | 'none'（检索合同——物理只读凭证
 *   在 db/client.ts 的 getDbReadonly() 强制，这里的字段是文档化权限
 *   意图，不是唯一的强制点，安全靠数据库凭证构造，不靠这个字段被遵守）
 */
export interface ContractPermission {
  read: "local" | "global" | "none";
  write: "proposal" | "none";
}

export interface AgentContract<TInput, TOutput> {
  name: ContractName;
  trigger: { kind: "job" | "event" | "cron"; topic: string };
  permission: ContractPermission;
  /** provider 字符串所属的模型选择（架构 5.2："按角色配模型"），P1 全部用 lib/ai/client.ts 的默认模型。 */
  model: string;
  outputSchema: z.ZodType<TOutput>;
  assembleContext: (input: TInput) => Promise<AssembledContext>;
  buildPrompt: (input: TInput, ctx: AssembledContext) => PromptSpec;
  /** 校验通过后把结构化输出写成提议态（或低风险自动生效）节点/边——只能调用 lib/graph。 */
  applyOutput: (
    input: TInput,
    ctx: AssembledContext,
    output: TOutput,
  ) => Promise<{ nodeIds: string[]; edgeIds: string[] }>;
}
