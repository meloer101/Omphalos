import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createNode, getNode, getNodeNeighborhood, getProvenance } from "@/lib/graph";
import { captureContract } from "@/lib/agents/contracts/capture";
import { resetGraph, TEST_PROJECT as PROJECT } from "./test-helpers";

/**
 * 捕获合同的 applyOutput/assembleContext 是纯图操作，不涉及模型调用——
 * 这里直接喂一个"假装模型已经吐出来"的结构化输出，验证 Phase1-开工
 * 计划.md 决策 C（风险分级落库）和"宁可漏连不可错连"落到代码上是否
 * 成立。真正打模型的链路已在 Phase0-开工计划.md 0.4 压测过（20/20），
 * 这里不重复验证那条命脉，只验证 applyOutput 这一段确定性代码。
 */
describe("捕获合同 applyOutput：风险分级落库", () => {
  beforeEach(resetGraph);
  afterAll(resetGraph);

  it("证据节点落 proposed；挂到既有需求的 supports 边（高风险）也落 proposed，出处/置信度写对", async () => {
    const feature = await createNode({
      type: "feature",
      projectId: PROJECT,
      title: "结算页支持微信支付",
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });

    const ctx = await captureContract.assembleContext({
      projectId: PROJECT,
      channel: "paste",
      rawText: "unused in this test",
    });
    expect(ctx.candidateNodes.map((n) => n.id)).toContain(feature.id);

    const { nodeIds, edgeIds } = await captureContract.applyOutput(
      { projectId: PROJECT, channel: "paste", rawText: "unused" },
      ctx,
      {
        items: [
          {
            title: "用户想要微信支付",
            bodyText: "原文摘录：结算的时候只能用支付宝",
            confidence: 0.9,
            supportsFeatureId: feature.id,
          },
        ],
      },
    );

    expect(nodeIds).toHaveLength(1);
    expect(edgeIds).toHaveLength(1);

    const evidenceNode = await getNode(nodeIds[0]);
    expect(evidenceNode?.status).toBe("proposed");

    const { incoming } = await getNodeNeighborhood(feature.id);
    const edge = incoming.find((e) => e.id === edgeIds[0]);
    expect(edge?.type).toBe("supports");
    expect(edge?.status).toBe("proposed");
    expect(edge?.risk).toBe("high");

    const [nodeProv] = await getProvenance({ nodeId: nodeIds[0] });
    expect(nodeProv.createdBy).toBe("capture");
    expect(nodeProv.confidence).toBe(0.9);
    expect(nodeProv.sourceRef).toMatchObject({ kind: "agent" });
  });

  it("回归：supports 边的出处也要带 batchId，跟节点一样——否则审批 tab 会把它错误拆成单独一组", async () => {
    const feature = await createNode({
      type: "feature",
      projectId: PROJECT,
      title: "结算页支持微信支付",
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });

    const ctx = await captureContract.assembleContext({
      projectId: PROJECT,
      channel: "paste",
      rawText: "unused",
    });

    const { nodeIds, edgeIds } = await captureContract.applyOutput(
      { projectId: PROJECT, channel: "paste", batchId: "batch-123", rawText: "unused" },
      ctx,
      {
        items: [
          {
            title: "用户想要微信支付",
            bodyText: "原文摘录",
            confidence: 0.9,
            supportsFeatureId: feature.id,
          },
        ],
      },
    );

    const [nodeProv] = await getProvenance({ nodeId: nodeIds[0] });
    const [edgeProv] = await getProvenance({ edgeId: edgeIds[0] });
    expect((nodeProv.sourceRef as { detail: { batchId?: string } }).detail.batchId).toBe(
      "batch-123",
    );
    expect((edgeProv.sourceRef as { detail: { batchId?: string } }).detail.batchId).toBe(
      "batch-123",
    );
  });

  it("没匹配到已有需求（supportsFeatureId 为 null）时只建证据节点，不连边——宁可漏连不可错连", async () => {
    const ctx = await captureContract.assembleContext({
      projectId: PROJECT,
      channel: "paste",
      rawText: "unused",
    });

    const { nodeIds, edgeIds } = await captureContract.applyOutput(
      { projectId: PROJECT, channel: "paste", rawText: "unused" },
      ctx,
      {
        items: [
          {
            title: "无法归类的反馈",
            bodyText: "……",
            confidence: 0.4,
            supportsFeatureId: null,
          },
        ],
      },
    );

    expect(nodeIds).toHaveLength(1);
    expect(edgeIds).toHaveLength(0);
  });

  it("跨批去重：新证据的标题跟已有证据高度相似时，提议一条 duplicates 边并自动 confirmed（决策 C：低风险边写入即生效）", async () => {
    const existing = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "用户希望结算页支持微信支付",
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });

    const ctx = await captureContract.assembleContext({
      projectId: PROJECT,
      channel: "paste",
      rawText: "unused",
    });

    const { nodeIds, edgeIds } = await captureContract.applyOutput(
      { projectId: PROJECT, channel: "paste", rawText: "unused" },
      ctx,
      {
        items: [
          {
            title: "用户反馈结算仅支持支付宝，希望增加微信支付",
            bodyText: "……",
            confidence: 0.7,
            supportsFeatureId: null,
          },
        ],
      },
    );

    expect(nodeIds).toHaveLength(1);
    expect(edgeIds).toHaveLength(1);

    const { incoming } = await getNodeNeighborhood(existing.id);
    const dupEdge = incoming.find((e) => e.id === edgeIds[0]);
    expect(dupEdge?.type).toBe("duplicates");
    expect(dupEdge?.risk).toBe("low");
    expect(dupEdge?.status).toBe("confirmed");
  });

  it("不跟同一批内刚创建的节点比较去重——单批内聚类是 prompt 的职责，不是这段代码的", async () => {
    const ctx = await captureContract.assembleContext({
      projectId: PROJECT,
      channel: "paste",
      rawText: "unused",
    });

    const { nodeIds, edgeIds } = await captureContract.applyOutput(
      { projectId: PROJECT, channel: "paste", rawText: "unused" },
      ctx,
      {
        items: [
          { title: "用户想要暗色模式", bodyText: "a", confidence: 0.8, supportsFeatureId: null },
          { title: "用户想要暗色模式", bodyText: "b", confidence: 0.8, supportsFeatureId: null },
        ],
      },
    );

    expect(nodeIds).toHaveLength(2);
    expect(edgeIds).toHaveLength(0);
  });

  it("会议头（head: 'meeting'）会把会议相关的抽取提示写进 prompt，反馈头则不会", () => {
    const ctx = { projectId: PROJECT, candidateNodes: [] };
    const meetingPrompt = captureContract.buildPrompt(
      { projectId: PROJECT, channel: "paste", head: "meeting", rawText: "会议纪要正文" },
      ctx,
    );
    const feedbackPrompt = captureContract.buildPrompt(
      { projectId: PROJECT, channel: "paste", rawText: "反馈正文" },
      ctx,
    );

    expect(meetingPrompt.prompt).toContain("决策");
    expect(feedbackPrompt.prompt).not.toContain("闲聊");
  });
});
