import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { getNode, getNodeNeighborhood, getProvenance } from "@/lib/graph";
import { importContract } from "@/lib/agents/contracts/import";
import { resetGraph, TEST_PROJECT as PROJECT } from "./test-helpers";

/**
 * 导入合同 applyOutput 是纯图操作（Phase2-开工计划.md 2.3，决策 H）。同
 * capture-contract.test.ts 的套路：喂一份"假装模型已吐出"的结构化输出，
 * 验证冷启动熔图落库正确——新建 feature/证据、用 ref 连 supports/because
 * 边、风险分级、出处带 batchId、ref 解析不到就跳过（宁可漏挂不可错挂）。
 */
describe("导入合同 applyOutput：冷启动熔图", () => {
  beforeEach(resetGraph);
  afterAll(resetGraph);

  const input = {
    projectId: PROJECT,
    source: "notion" as const,
    docTitle: "结算页支付方式",
    rawText: "（本测试直接喂结构化输出，不经过模型，rawText 不参与 applyOutput）",
    batchId: "import-batch-1",
  };

  it("新建 feature + evidence 节点（proposed），用 ref 连 because/supports 边（高风险 proposed）", async () => {
    const { nodeIds, edgeIds } = await importContract.applyOutput(
      input,
      { projectId: PROJECT, candidateNodes: [] },
      {
        features: [
          { ref: "f1", title: "结算页支付方式", bodyText: "推迟微信支付", confidence: 0.9 },
        ],
        evidences: [
          { ref: "e1", title: "合规未过", bodyText: "十月合规结论", confidence: 0.8 },
          { ref: "e2", title: "客户要微信支付", bodyText: "多位客户反馈", confidence: 0.7 },
        ],
        edges: [
          { type: "because", srcRef: "f1", dstRef: "e1", confidence: 0.85 },
          { type: "supports", srcRef: "e2", dstRef: "f1", confidence: 0.75 },
        ],
      },
    );

    expect(nodeIds).toHaveLength(3);
    expect(edgeIds).toHaveLength(2);

    // 所有导入节点一律 proposed。
    for (const id of nodeIds) {
      expect((await getNode(id))?.status).toBe("proposed");
    }

    // feature 的出边里应有一条 because（高风险 → proposed）。
    const feature = (await getNode(nodeIds[0]))!;
    const { outgoing, incoming } = await getNodeNeighborhood(feature.id);
    const because = outgoing.find((e) => e.type === "because");
    expect(because?.status).toBe("proposed");
    expect(because?.risk).toBe("high");
    // 以及一条来自证据的 supports 入边。
    const supports = incoming.find((e) => e.type === "supports");
    expect(supports?.status).toBe("proposed");

    // 出处：createdBy=import，带 batchId 和 source。
    const [prov] = await getProvenance({ nodeId: feature.id });
    expect(prov.createdBy).toBe("import");
    expect(prov.sourceRef).toMatchObject({
      kind: "import",
      detail: { batchId: "import-batch-1", source: "notion" },
    });
  });

  it("ref 解析不到的边直接跳过，不建悬空边（宁可漏挂不可错挂）", async () => {
    const { nodeIds, edgeIds } = await importContract.applyOutput(
      input,
      { projectId: PROJECT, candidateNodes: [] },
      {
        features: [{ ref: "f1", title: "需求", bodyText: "正文", confidence: 0.9 }],
        evidences: [],
        edges: [
          // dstRef 'ghost' 没声明过 → 整条边丢弃。
          { type: "because", srcRef: "f1", dstRef: "ghost", confidence: 0.8 },
        ],
      },
    );

    expect(nodeIds).toHaveLength(1);
    expect(edgeIds).toHaveLength(0);
    const { outgoing } = await getNodeNeighborhood(nodeIds[0]);
    expect(outgoing).toHaveLength(0);
  });
});
