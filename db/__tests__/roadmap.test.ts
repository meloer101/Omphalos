import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createNode, createEdge, listRoadmapFeatures } from "@/lib/graph";
import { resetGraph, TEST_PROJECT as PROJECT } from "./test-helpers";

/**
 * Roadmap 视图的状态推导（Phase1-开工计划.md 1.5）：状态不是字段，是
 * 从 implements 入边连接的任务看板状态聚合出来的。这里锁死三种情形。
 */
describe("listRoadmapFeatures：状态从连接任务的看板状态推导", () => {
  beforeEach(resetGraph);
  afterAll(resetGraph);

  async function makeTask(boardStatus: "todo" | "in_progress" | "done") {
    return createNode({
      type: "task",
      projectId: PROJECT,
      title: `任务 (${boardStatus})`,
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    }).then(async (task) => {
      if (boardStatus !== "todo") {
        const { updateNode } = await import("@/lib/graph");
        await updateNode(task.id, { boardStatus });
      }
      return task;
    });
  }

  it("没有任何 implements 边时是 planned", async () => {
    await createNode({
      type: "feature",
      projectId: PROJECT,
      title: "无任务的需求",
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });

    const [result] = await listRoadmapFeatures(PROJECT);
    expect(result.status).toBe("planned");
    expect(result.taskCount).toBe(0);
  });

  it("全部任务还是 todo 时是 planned", async () => {
    const feature = await createNode({
      type: "feature",
      projectId: PROJECT,
      title: "任务都还没开始的需求",
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const task = await makeTask("todo");
    await createEdge({
      type: "implements",
      srcId: task.id,
      dstId: feature.id,
      projectId: PROJECT,
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });

    const [result] = await listRoadmapFeatures(PROJECT);
    expect(result.status).toBe("planned");
    expect(result.taskCount).toBe(1);
  });

  it("部分任务进行中/完成、不是全部完成时是 in_progress", async () => {
    const feature = await createNode({
      type: "feature",
      projectId: PROJECT,
      title: "部分推进的需求",
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const doneTask = await makeTask("done");
    const todoTask = await makeTask("todo");
    for (const task of [doneTask, todoTask]) {
      await createEdge({
        type: "implements",
        srcId: task.id,
        dstId: feature.id,
        projectId: PROJECT,
        status: "confirmed",
        createdBy: "human",
        sourceRef: { kind: "human", detail: {} },
      });
    }

    const [result] = await listRoadmapFeatures(PROJECT);
    expect(result.status).toBe("in_progress");
    expect(result.taskCount).toBe(2);
  });

  it("全部任务都完成时是 done", async () => {
    const feature = await createNode({
      type: "feature",
      projectId: PROJECT,
      title: "全部完成的需求",
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const task = await makeTask("done");
    await createEdge({
      type: "implements",
      srcId: task.id,
      dstId: feature.id,
      projectId: PROJECT,
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });

    const [result] = await listRoadmapFeatures(PROJECT);
    expect(result.status).toBe("done");
  });

  it("按创建时间升序排列", async () => {
    const first = await createNode({
      type: "feature",
      projectId: PROJECT,
      title: "先建的需求",
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    await new Promise((r) => setTimeout(r, 10));
    const second = await createNode({
      type: "feature",
      projectId: PROJECT,
      title: "后建的需求",
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });

    const result = await listRoadmapFeatures(PROJECT);
    expect(result.map((r) => r.node.id)).toEqual([first.id, second.id]);
  });
});
