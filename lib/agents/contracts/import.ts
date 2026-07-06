import { z } from "zod";
import { createEdge, createNode } from "@/lib/graph";
import { edgeRiskOf } from "@/db/enums";
import type { AgentContract, AssembledContext } from "@/lib/agents/contract";
import { getBoss, QUEUE } from "@/lib/queue/boss";
import { importHead } from "@/lib/agents/preprocess/import";

/**
 * 冷启动导入合同（Phase2-开工计划.md 2.3，PRD R7，决策 H）。复用捕获同一条
 * 五段流水线（runPipeline）与 lib/graph 写入口 + 决策 C 风险分级，但输出
 * schema 更宽：允许从历史文档新建 feature/证据节点并挂 supports/because 边，
 * 把"当初为什么"的因果链一次性熔进图。paste 捕获合同不受影响、不回归。
 *
 * 每份文档一个 job（app/api/import 拆分 → pg-boss 并行）。文档自包含：
 * 节点用文档内 ref 互相连边，不跨文档引用——冷启动阶段够用，跨文档的
 * 挂接留给后续实时捕获。
 */

export type ImportSource = "markdown" | "csv" | "notion";

export interface ImportInput {
  projectId: string;
  source: ImportSource;
  /** 文档标题（Notion 取文件名/frontmatter，MD 取首个标题或文件名）。 */
  docTitle?: string;
  rawText: string;
  batchId?: string;
}

// 模型用文档内 ref（自己起的短标识）声明节点，再用 ref 连边。applyOutput
// 负责把 ref 映射成真实节点 id——模型不接触也无从伪造真实 id。
const nodeItem = z.object({
  ref: z.string().describe("文档内唯一短标识，供 edges 引用，如 'f1'/'e2'"),
  title: z.string().describe("一句话标题"),
  bodyText: z.string().describe("正文摘录或复述"),
  confidence: z.number().min(0).max(1).describe("抽取把握程度"),
});

export const importOutputSchema = z.object({
  features: z.array(nodeItem).describe("从文档抽出的需求/决策节点"),
  evidences: z.array(nodeItem).describe("支撑需求或作为约束/原因的证据节点"),
  edges: z
    .array(
      z.object({
        // 冷启动只抽这两类高价值因果边；其余边类型留给人工/后续捕获。
        type: z.enum(["supports", "because"]),
        srcRef: z.string().describe("边起点节点的 ref"),
        dstRef: z.string().describe("边终点节点的 ref"),
        confidence: z.number().min(0).max(1),
      }),
    )
    .describe(
      "supports: 证据ref→需求ref；because: 需求ref→原因(证据/约束)ref。只挂文档明确写到的因果。",
    ),
});

export type ImportOutput = z.infer<typeof importOutputSchema>;

// 导入合同自包含，不需要查图装配候选（每份文档独立熔图）。
async function assembleContext(input: ImportInput): Promise<AssembledContext> {
  return { projectId: input.projectId, candidateNodes: [] };
}

function buildPrompt(input: ImportInput) {
  return {
    system:
      "你是一个把团队历史文档结构化成产品因果图的助手。你的输出只能通过调用工具提交，" +
      "禁止只用文字回答。宁可漏挂不可错挂：文档没写明的因果关系不要编。",
    prompt: `${importHead.describe}
${importHead.extractionHint}

先在 features / evidences 里声明节点并各起一个文档内 ref，再在 edges 里用 ref 连边。
edges 的 srcRef/dstRef 必须都是上面声明过的 ref。

文档标题：${input.docTitle ?? "（无）"}
来源：${input.source}
文档正文：
${input.rawText}`,
  };
}

async function applyOutput(
  input: ImportInput,
  _ctx: AssembledContext,
  output: ImportOutput,
) {
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  const refToId = new Map<string, string>();

  const sourceDetail = (rawExcerpt: string) => ({
    kind: "import" as const,
    detail: {
      contract: "import",
      source: input.source,
      docTitle: input.docTitle,
      batchId: input.batchId,
      rawExcerpt,
    },
  });

  // 先建全部节点（proposed，Phase1 决策 C：导入产出的节点一律走确认）。
  for (const [type, items] of [
    ["feature", output.features],
    ["evidence", output.evidences],
  ] as const) {
    for (const item of items) {
      const node = await createNode({
        type,
        projectId: input.projectId,
        title: item.title,
        body: { text: item.bodyText },
        status: "proposed",
        createdBy: "import",
        sourceRef: sourceDetail(item.bodyText),
        confidence: item.confidence,
      });
      // ref 冲突时后者不覆盖前者，避免边错连到重名 ref 的另一节点。
      if (!refToId.has(item.ref)) refToId.set(item.ref, node.id);
      nodeIds.push(node.id);
    }
  }

  // 再连边：ref 解析不到就跳过（宁可漏挂不可错挂），不让一条悬空边污染图。
  for (const edge of output.edges) {
    const srcId = refToId.get(edge.srcRef);
    const dstId = refToId.get(edge.dstRef);
    if (!srcId || !dstId) continue;

    const created = await createEdge({
      type: edge.type,
      srcId,
      dstId,
      projectId: input.projectId,
      // supports/because 都是高风险边 → proposed，须人在审批 tab 确认
      // （复用决策 C 的通用表达式，不硬编码）。
      status: edgeRiskOf(edge.type) === "high" ? "proposed" : "confirmed",
      createdBy: "import",
      sourceRef: sourceDetail(`${edge.srcRef} -${edge.type}-> ${edge.dstRef}`),
      confidence: edge.confidence,
    });
    edgeIds.push(created.id);
  }

  return { nodeIds, edgeIds };
}

export const importContract: AgentContract<ImportInput, ImportOutput> = {
  name: "import",
  trigger: { kind: "job", topic: "import" },
  permission: { read: "local", write: "proposal" },
  model: "default",
  outputSchema: importOutputSchema,
  assembleContext,
  buildPrompt,
  applyOutput,
};

/** 入口层（app/api/import）调用：把一份文档丢进 import 队列，异步熔图。 */
export async function enqueueImport(input: ImportInput): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE.import, input);
}
