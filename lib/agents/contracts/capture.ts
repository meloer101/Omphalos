import { z } from "zod";
import { createEdge, createNode, listNodesByType } from "@/lib/graph";
import { edgeRiskOf } from "@/db/enums";
import type { AgentContract, AssembledContext } from "@/lib/agents/contract";
import { getBoss, QUEUE } from "@/lib/queue/boss";
import { getPreprocessHead, type PreprocessHeadName } from "@/lib/agents/preprocess";
import { findLikelyDuplicate } from "@/lib/agents/dedup";

/**
 * 捕获合同（PRD R3、Agent架构设计.md 决策点 6）。P1 决策 B：入口只有
 * 粘贴文本 + 文件上传，邮件转发仅占位不接真实收信。
 *
 * 一个抽取内核（本文件）+ 按来源可换的预处理头（lib/agents/preprocess）
 * ——头只调整 prompt 的措辞和侧重，输出 schema 永远是下面这一个，图的
 * 入口只有一个、可校验点只有一个。
 */

export type CaptureChannel = "paste" | "file" | "inbound-email";

export interface CaptureInput {
  projectId: string;
  channel: CaptureChannel;
  /** 默认 'feedback'——大多数捕获是用户反馈；会议记录显式传 'meeting'。 */
  head?: PreprocessHeadName;
  rawText: string;
  /**
   * 一次捕获调用的分组键（worker/index.ts 用 pg-boss 的 job.id 填充）。
   * 只写进 sourceRef.detail，不进 schema——审批 tab（app/review）按天/
   * 按批次分组时从这里读，不需要新的数据库列。所有写入操作（节点、
   * supports 边、duplicates 边）都必须带上它，否则会在审批 tab 里被
   * 错误拆成单独一组（上一轮踩过这个坑：supports 边漏写了 batchId）。
   */
  batchId?: string;
}

export const captureOutputSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().describe("一句话标题，概括这条证据"),
        bodyText: z.string().describe("原文摘录或复述"),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .describe("这条抽取结果的把握程度"),
        supportsFeatureId: z
          .string()
          .uuid()
          .nullable()
          .describe(
            "如果这条证据明显支撑某个已有需求节点，填其 id（须来自候选清单）；" +
              "否则为 null——P1 不臆测新需求，只挂已存在的候选，宁可漏连不可错连",
          ),
      }),
    )
    .describe("从原始输入中抽取出的独立证据条目列表（同一件事的不同表达已合并）"),
});

export type CaptureOutput = z.infer<typeof captureOutputSchema>;

async function assembleContext(input: CaptureInput): Promise<AssembledContext> {
  const features = await listNodesByType(input.projectId, "feature");
  return {
    projectId: input.projectId,
    candidateNodes: features.map((f) => ({
      id: f.id,
      type: f.type,
      title: f.title,
    })),
  };
}

function buildPrompt(input: CaptureInput, ctx: AssembledContext) {
  const head = getPreprocessHead(input.head ?? "feedback");
  const candidateList =
    ctx.candidateNodes.length > 0
      ? ctx.candidateNodes.map((n) => `- ${n.id}: ${n.title}`).join("\n")
      : "（当前项目还没有任何需求节点）";

  return {
    system:
      "你是一个产品证据结构化助手。你的输出只能通过调用工具提交，禁止只用文字回答。" +
      "宁可漏连不可错连：不确定某条证据是否支撑某个已有需求时，supportsFeatureId 填 null。",
    prompt: `${head.describe}
${head.extractionHint}

如果原始输入里出现多条明显在说同一件事的表达，合并成一条证据（单批内去重聚类），
不要为同一件事重复建条目。

已有需求节点候选（如果某条证据明显支撑其中之一，填它的 id；否则 supportsFeatureId 为 null）：
${candidateList}

原始输入（来源：${input.channel}）：
${input.rawText}`,
  };
}

async function applyOutput(
  input: CaptureInput,
  _ctx: AssembledContext,
  output: CaptureOutput,
) {
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];

  // 跨批去重候选——写入前的快照，只跟"已经在库里的证据"比对，不跟同一
  // 批内刚创建的节点比较（同批内的聚类是 buildPrompt 的活，见上面的
  // "单批内去重聚类"提示）。
  const existingEvidence = await listNodesByType(input.projectId, "evidence");
  const duplicateCandidates = existingEvidence.map((n) => ({
    id: n.id,
    title: n.title,
  }));

  for (const item of output.items) {
    const node = await createNode({
      type: "evidence",
      projectId: input.projectId,
      title: item.title,
      body: { text: item.bodyText },
      // 捕获产出的节点一律 proposed（Phase1-开工计划.md 决策 C）。
      status: "proposed",
      createdBy: "capture",
      sourceRef: {
        kind: "agent",
        detail: {
          contract: "capture",
          channel: input.channel,
          batchId: input.batchId,
          rawExcerpt: item.bodyText,
        },
      },
      confidence: item.confidence,
    });
    nodeIds.push(node.id);

    if (item.supportsFeatureId) {
      const edge = await createEdge({
        type: "supports",
        srcId: node.id,
        dstId: item.supportsFeatureId,
        projectId: input.projectId,
        // 决策 C：edgeRiskOf 权威判定风险——高风险边（supports 恒在此列）
        // 落 proposed 必须人确认；写成通用表达式而非硬编码 "proposed"，
        // 是为了这里加别的边类型时这段逻辑不用改（下面的 duplicates
        // 就是同一段逻辑复用的第一个例子）。
        status: edgeRiskOf("supports") === "high" ? "proposed" : "confirmed",
        createdBy: "capture",
        sourceRef: {
          kind: "agent",
          detail: {
            contract: "capture",
            channel: input.channel,
            batchId: input.batchId,
            rawExcerpt: item.bodyText,
          },
        },
        confidence: item.confidence,
      });
      edgeIds.push(edge.id);
    }

    // 跨批去重：title 粗匹配（lib/agents/dedup.ts），命中就提议一条
    // duplicates 边。duplicates 是低风险边，写入即 confirmed（决策 C），
    // 审批 tab 提供撤销，不阻塞捕获流程。
    const duplicate = findLikelyDuplicate(item.title, duplicateCandidates);
    if (duplicate) {
      const dupEdge = await createEdge({
        type: "duplicates",
        srcId: node.id,
        dstId: duplicate.id,
        projectId: input.projectId,
        status: edgeRiskOf("duplicates") === "high" ? "proposed" : "confirmed",
        createdBy: "capture",
        sourceRef: {
          kind: "agent",
          detail: {
            contract: "capture",
            batchId: input.batchId,
            method: "title-bigram-jaccard",
            score: duplicate.score,
          },
        },
        confidence: duplicate.score,
      });
      edgeIds.push(dupEdge.id);
    }
  }

  return { nodeIds, edgeIds };
}

export const captureContract: AgentContract<CaptureInput, CaptureOutput> = {
  name: "capture",
  // topic 是文档化字面量，特意不从 QUEUE.capture 派生——contract 描述
  // "这份合同长什么样"，不关心它被谁调度；worker/index.ts 才是实际把
  // topic 接到 QUEUE.capture 的地方。两处字面量须保持一致。
  trigger: { kind: "job", topic: "capture" },
  permission: { read: "local", write: "proposal" },
  model: "default",
  outputSchema: captureOutputSchema,
  assembleContext,
  buildPrompt,
  applyOutput,
};

/** 入口层（capture 的粘贴/上传 route）调用这个把一次捕获请求丢进队列，异步返回。 */
export async function enqueueCapture(input: CaptureInput): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUE.capture, input);
}
