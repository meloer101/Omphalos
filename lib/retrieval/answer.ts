import { streamText } from "ai";
import { getFastModel } from "@/lib/ai/client";
import { embedQuery, semanticSearch } from "./search";
import { traverseFromEntries } from "./traverse";
import { assignHandles, buildSourceList, type CitationSource } from "./cite";

/**
 * 检索 Agent 的两段式主流程（Phase2-开工计划.md 2.2，架构决策点 2）：
 *   问题向量化 → 语义定位入口(search) → 沿类型边行走(traverse) → 生成(streamText)。
 *
 * 全程只读（search/traverse 都用 getDbReadonly），生成层被硬约束为只能
 * 引用走到的节点。入口为空或子图为空 → 直接走"图里没有记录"，**不进模型**
 * （既省 token 又从源头堵幻觉：没有事实可引用时，最安全的回答是承认没有）。
 */

export const NO_RECORD_MESSAGE = "图里没有记录。";

export type AnswerResult =
  | { kind: "no_record" }
  | {
      kind: "answer";
      scope: "local" | "global";
      /** 供前端建句柄→深链映射、渲染行内引用。 */
      sources: CitationSource[];
      /** 模型逐字产出的原始文本（含 [句柄] 标记，前端用 cite.ts 解析）。 */
      textStream: AsyncIterable<string>;
    };

const SYSTEM_PROMPT =
  "你是产品团队的追溯助手。你只能依据下面给出的「可引用来源」回答，" +
  "严禁使用来源之外的任何知识或推测。规则：\n" +
  "1. 每一句事实陈述后面，必须紧跟它的来源句柄，格式 [E1]、[F2]（可多个 [E1][E3]）。\n" +
  "2. 只能引用来源清单里出现过的句柄，绝不能编造句柄或 id。\n" +
  "3. 如果来源不足以回答问题，直接说「图里没有记录」，不要硬凑。\n" +
  "4. 用自然语言段落回答，像正常对话里引一句话那样把引用嵌进句子，不要写成列表或「来源」区块。";

export async function answerQuestion(
  question: string,
  projectId: string,
): Promise<AnswerResult> {
  const queryEmbedding = await embedQuery(question);
  const hits = await semanticSearch(projectId, queryEmbedding);
  if (hits.length === 0) return { kind: "no_record" };

  const subgraph = await traverseFromEntries(hits.map((h) => h.id));
  if (subgraph.nodes.length === 0) return { kind: "no_record" };

  const handles = assignHandles(subgraph.nodes);
  const sourceList = buildSourceList(subgraph.nodes, handles);
  // scope 取自入口命中：只要有一个入口来自其它项目，就是升级式全局命中。
  const scope: "local" | "global" = hits.some((h) => h.scope === "global")
    ? "global"
    : "local";

  const result = streamText({
    model: getFastModel(),
    system: SYSTEM_PROMPT,
    prompt: `问题：${question}\n\n可引用来源（只能引用这些句柄）：\n\n${sourceList}`,
  });

  return {
    kind: "answer",
    scope,
    sources: [...handles.values()],
    textStream: result.textStream,
  };
}
