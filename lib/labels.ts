import type { NodeType, EdgeType } from "@/db/enums";

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  evidence: "证据",
  feature: "需求",
  task: "任务",
  outcome: "结果",
};

export const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  supports: "支撑",
  implements: "实现",
  validates: "验证",
  refutes: "证伪",
  because: "因为",
  supersedes: "取代",
  duplicates: "重复",
  blocks: "阻塞",
};
