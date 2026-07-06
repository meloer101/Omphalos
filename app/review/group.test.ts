import { describe, it, expect } from "vitest";
import { groupReviewItems } from "./group";
import type { ReviewItem } from "@/lib/graph";
import type { Node, Provenance } from "@/db/schema";

function makeNode(overrides: Partial<Node> & { id: string; createdAt: Date }): Node {
  return {
    type: "evidence",
    projectId: "p1",
    title: "标题",
    body: {},
    status: "proposed",
    boardStatus: "todo",
    embedding: null,
    updatedAt: overrides.createdAt,
    ...overrides,
  } as Node;
}

function makeProvenance(sourceRef: unknown): Provenance {
  return {
    id: "prov-1",
    edgeId: null,
    nodeId: null,
    sourceRef,
    createdBy: "capture",
    confidence: null,
    createdAt: new Date(),
  } as Provenance;
}

function nodeItem(id: string, createdAt: Date, batchId?: string): ReviewItem {
  return {
    kind: "node",
    node: makeNode({ id, createdAt }),
    provenance: makeProvenance(
      batchId ? { kind: "agent", detail: { batchId, channel: "paste" } } : { kind: "human", detail: {} },
    ),
  };
}

describe("groupReviewItems", () => {
  it("同一 batchId 的多个 item 分进同一组", () => {
    const day = new Date("2026-07-06T03:00:00Z");
    const items = [
      nodeItem("a", day, "batch-1"),
      nodeItem("b", day, "batch-1"),
    ];
    const groups = groupReviewItems(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].batchId).toBe("batch-1");
    expect(groups[0].channel).toBe("paste");
  });

  it("没有 batchId（人工创建）的每条各自成组，不会被拼到一起", () => {
    const day = new Date("2026-07-06T03:00:00Z");
    const items = [nodeItem("a", day), nodeItem("b", day)];
    const groups = groupReviewItems(items);
    expect(groups).toHaveLength(2);
  });

  it("不同天的同一 batchId 不会被合并（day 是分组键的一部分）", () => {
    const day1 = new Date("2026-07-05T03:00:00Z");
    const day2 = new Date("2026-07-06T03:00:00Z");
    const items = [nodeItem("a", day1, "batch-1"), nodeItem("b", day2, "batch-1")];
    const groups = groupReviewItems(items);
    expect(groups).toHaveLength(2);
  });

  it("按组内最新时间倒序排列——最近的批次排最前", () => {
    const older = new Date("2026-07-01T00:00:00Z");
    const newer = new Date("2026-07-06T00:00:00Z");
    const items = [nodeItem("old", older, "batch-old"), nodeItem("new", newer, "batch-new")];
    const groups = groupReviewItems(items);
    expect(groups[0].batchId).toBe("batch-new");
    expect(groups[1].batchId).toBe("batch-old");
  });
});
