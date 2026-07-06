/**
 * 跨批去重的"title 粗匹配"（Phase1-开工计划.md 1.2："跨批去重靠 title
 * 粗匹配 + duplicates 低风险边草案"）。故意不接语义检索/embedding——
 * 那是 P2 的事（Agent架构设计.md 5.1 "P1 无向量检索"）。这里只是字符
 * 二元组（bigram）集合的 Jaccard 相似度粗筛，不追求精确匹配，只用来
 * 提议低风险的 duplicates 边：宁可漏判（不去重，人工看到两条相似证据
 * 自己判断）也不错判（错误连了并不重复的两条）。
 *
 * 中文标题没有空格分词，按词切分不可行；字符二元组不需要分词库，
 * 中英文都适用。阈值取自真实标题样本校准（见 Phase1-开工计划.md 1.3
 * 复盘记录）：初版用手写样本定的 0.28，接入真实模型后发现短标题的真
 * 实重复对能低至 0.25（模型倾向于用不同措辞概括同一句话，字符级重叠
 * 比手写样本预想的更少）；扩充样本后真重复对落在 0.25~0.44，真不重复
 * 对落在 0.00~0.10，改到 0.2，两头都留出安全边际。
 */

const PUNCTUATION_AND_WHITESPACE =
  /[，。！？、,.!?"'“”‘’（）()\s]+/g;

const DUPLICATE_THRESHOLD = 0.2;

function tokenize(title: string): Set<string> {
  const normalized = title.toLowerCase().replace(PUNCTUATION_AND_WHITESPACE, "");
  const bigrams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) {
    bigrams.add(normalized.slice(i, i + 2));
  }
  // 单字符（或空）标题没有二元组，兜底存整串，避免恒为空集导致永远判不重复。
  if (bigrams.size === 0 && normalized.length > 0) {
    bigrams.add(normalized);
  }
  return bigrams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface DuplicateCandidate {
  id: string;
  title: string;
}

export interface DuplicateMatch {
  id: string;
  score: number;
}

/** 返回相似度最高且过线的候选，没有则 undefined。 */
export function findLikelyDuplicate(
  title: string,
  candidates: DuplicateCandidate[],
): DuplicateMatch | undefined {
  const tokens = tokenize(title);
  let best: DuplicateMatch | undefined;
  for (const candidate of candidates) {
    const score = jaccard(tokens, tokenize(candidate.title));
    if (score >= DUPLICATE_THRESHOLD && (!best || score > best.score)) {
      best = { id: candidate.id, score };
    }
  }
  return best;
}
