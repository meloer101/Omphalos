import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createNode, createEdge, confirmNode, listPendingReview } from "@/lib/graph";
import { resetGraph, TEST_PROJECT as PROJECT } from "./test-helpers";

/**
 * 审批 tab 的数据源（Phase1-开工计划.md 1.3）：验证 listPendingReview
 * 正确区分"必须显式确认"（proposed）和"已自动生效可撤销"（confirmed
 * 低风险边），且不把已确认节点/高风险边混进任何一边。
 */
describe("listPendingReview", () => {
  beforeEach(resetGraph);
  afterAll(resetGraph);

  it("提议中的节点和边出现在 pending，已确认的节点不出现", async () => {
    const proposedNode = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "提议中的证据",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const confirmedNode = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "已确认的证据",
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const feature = await createNode({
      type: "feature",
      projectId: PROJECT,
      title: "需求",
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const proposedEdge = await createEdge({
      type: "supports",
      srcId: proposedNode.id,
      dstId: feature.id,
      projectId: PROJECT,
      createdBy: "capture",
      sourceRef: { kind: "agent", detail: {} },
    });

    const { pending, revocable } = await listPendingReview(PROJECT);

    const pendingNodeIds = pending
      .filter((i) => i.kind === "node")
      .map((i) => (i.kind === "node" ? i.node.id : null));
    expect(pendingNodeIds).toContain(proposedNode.id);
    expect(pendingNodeIds).not.toContain(confirmedNode.id);
    expect(pendingNodeIds).not.toContain(feature.id);

    const pendingEdgeIds = pending
      .filter((i) => i.kind === "edge")
      .map((i) => (i.kind === "edge" ? i.edge.id : null));
    expect(pendingEdgeIds).toContain(proposedEdge.id);
    expect(revocable).toHaveLength(0);
  });

  it("已确认的低风险边出现在 revocable；已确认的高风险边两边都不出现", async () => {
    const a = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "证据 A",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const b = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "证据 B",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const feature = await createNode({
      type: "feature",
      projectId: PROJECT,
      title: "需求",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    await confirmNode(feature.id, "human");

    const lowRiskConfirmed = await createEdge({
      type: "duplicates",
      srcId: a.id,
      dstId: b.id,
      projectId: PROJECT,
      status: "confirmed",
      createdBy: "capture",
      sourceRef: { kind: "agent", detail: {} },
    });

    const highRiskConfirmed = await createEdge({
      type: "supports",
      srcId: a.id,
      dstId: feature.id,
      projectId: PROJECT,
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const { confirmEdge } = await import("@/lib/graph");
    await confirmEdge(highRiskConfirmed.id, "human");

    const { pending, revocable } = await listPendingReview(PROJECT);

    const revocableIds = revocable.map((i) => i.edge.id);
    expect(revocableIds).toContain(lowRiskConfirmed.id);
    expect(revocableIds).not.toContain(highRiskConfirmed.id);

    const pendingEdgeIds = pending
      .filter((i) => i.kind === "edge")
      .map((i) => (i.kind === "edge" ? i.edge.id : null));
    expect(pendingEdgeIds).not.toContain(highRiskConfirmed.id);
    expect(pendingEdgeIds).not.toContain(lowRiskConfirmed.id);
  });
});
