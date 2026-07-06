import type { ReachableNode } from "./traverse";
import type { NodeType } from "@/db/enums";

/**
 * 引用护栏（Phase2-开工计划.md 决策 G）：追溯"错误引用 0 容忍"的**真正**
 * 保证点，是这里确定性的求交校验，不是模型自律。
 *
 * 为什么用短句柄（E1/F2/…）而不是让模型直接吐 UUID：UUID 又长又难复现，
 * 模型极易吐错一位 → 要么变成悬空引用、要么恰好撞上另一个节点（灾难）。
 * 改成"prompt 里给每个可达节点配一个短句柄，模型只引用句柄"，于是：
 *  - 句柄不在映射表里 = 一眼可判的幻觉，直接剥离；
 *  - 句柄→真实 id 的映射由我们掌握，模型无从伪造一个"看起来对"的深链。
 * 整个校验不依赖 LLM，可脱机单测（见 __tests__/cite.test.ts）。
 */

export interface CitationSource {
  handle: string;
  id: string;
  type: NodeType;
  title: string;
}

/** 渲染用的答案分段：纯文本片段，或一个指向节点的行内引用。 */
export type AnswerSegment =
  | { kind: "text"; text: string }
  | { kind: "cite"; id: string; title: string; nodeType: NodeType; handle: string };

export interface ParsedAnswer {
  segments: AnswerSegment[];
  /** 实际被合法引用到的节点（去重），供前端汇总/埋点。 */
  citations: CitationSource[];
  /** 被剥离的非法句柄（模型幻觉出来的），供日志与评估断言。 */
  strippedHandles: string[];
}

const HANDLE_RE = /\[([A-Za-z]\d+)\]/g;

const TYPE_PREFIX: Record<NodeType, string> = {
  evidence: "E",
  feature: "F",
  task: "T",
  outcome: "O",
};

/**
 * 给可达节点集合分配稳定短句柄（E1/F1/T1/O1…），按类型前缀 + 出现序号。
 * 返回句柄→节点 的映射，两处共用：buildSourceList 喂进 prompt，
 * parseCitedAnswer 校验模型产出。
 */
export function assignHandles(nodes: ReachableNode[]): Map<string, CitationSource> {
  const counters: Record<NodeType, number> = {
    evidence: 0,
    feature: 0,
    task: 0,
    outcome: 0,
  };
  const map = new Map<string, CitationSource>();
  for (const n of nodes) {
    const handle = `${TYPE_PREFIX[n.type]}${++counters[n.type]}`;
    map.set(handle, { handle, id: n.id, type: n.type, title: n.title });
  }
  return map;
}

/**
 * 把可达节点渲染成 prompt 里的"可引用来源清单"。模型被要求：只能引用
 * 这份清单里的句柄，每句事实陈述末尾用 [句柄] 标注来源。
 */
export function buildSourceList(
  nodes: ReachableNode[],
  handles: Map<string, CitationSource>,
): string {
  const byId = new Map([...handles.values()].map((h) => [h.id, h.handle]));
  return nodes
    .map((n) => `[${byId.get(n.id)}] (${n.type}) ${n.title}\n${n.excerpt}`)
    .join("\n\n");
}

/**
 * 解析模型产出：把 [句柄] 标记切成行内引用分段，合法句柄映射为深链、
 * 非法句柄剥离。确定性、可脱 LLM 单测——这是 0 容忍的把关处。
 */
export function parseCitedAnswer(
  raw: string,
  handles: Map<string, CitationSource>,
): ParsedAnswer {
  const segments: AnswerSegment[] = [];
  const citedIds = new Set<string>();
  const citations: CitationSource[] = [];
  const strippedHandles: string[] = [];

  let lastIndex = 0;
  for (const match of raw.matchAll(HANDLE_RE)) {
    const [full, rawHandle] = match;
    const start = match.index ?? 0;

    if (start > lastIndex) {
      segments.push({ kind: "text", text: raw.slice(lastIndex, start) });
    }
    lastIndex = start + full.length;

    // 句柄大小写规整（模型偶尔小写）后查表。
    const handle = rawHandle.toUpperCase();
    const source = handles.get(handle);
    if (!source) {
      // 幻觉引用：整段标记连同它一起丢掉，不留任何痕迹在答案里。
      strippedHandles.push(rawHandle);
      continue;
    }
    segments.push({
      kind: "cite",
      id: source.id,
      title: source.title,
      nodeType: source.type,
      handle: source.handle,
    });
    if (!citedIds.has(source.id)) {
      citedIds.add(source.id);
      citations.push(source);
    }
  }
  if (lastIndex < raw.length) {
    segments.push({ kind: "text", text: raw.slice(lastIndex) });
  }

  return { segments, citations, strippedHandles };
}
