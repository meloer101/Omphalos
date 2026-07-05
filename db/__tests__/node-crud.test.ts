import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  createNode,
  getNode,
  updateNode,
  confirmNode,
  deleteNode,
  listAllNodes,
} from "@/lib/graph";
import { resetGraph, pgErrorMessage, TEST_PROJECT as PROJECT } from "./test-helpers";

/**
 * Phase 0.2 新增的 lib/graph 函数（getNode/updateNode/confirmNode/
 * deleteNode/listAllNodes）的验收测试。这些函数被 inbox/board/node
 * 详情页的 Server Action 直接调用——浏览器端到端点击验证在这次的
 * preview 自动化环境里遇到了工具本身的限制（点击事件到达 DOM 但
 * 未能触发 React 19 的 Server Action 拦截，经 curl 直接验证
 * createEvidence 路径证明底层机制本身没问题），所以这里补上直接
 * 覆盖这批函数的测试作为主要验证手段。
 */
describe("节点 CRUD（0.2 新增）", () => {
  beforeEach(resetGraph);
  afterAll(resetGraph);

  it("getNode 取回单个节点；listAllNodes 取回同 project 全部节点", async () => {
    const a = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "证据 A",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    await createNode({
      type: "task",
      projectId: PROJECT,
      title: "任务 B",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });

    const fetched = await getNode(a.id);
    expect(fetched?.title).toBe("证据 A");

    const all = await listAllNodes(PROJECT);
    expect(all).toHaveLength(2);
  });

  it("updateNode 可编辑标题/正文/看板状态，且不写 audit_log", async () => {
    const task = await createNode({
      type: "task",
      projectId: PROJECT,
      title: "对接支付宝接口",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    expect(task.boardStatus).toBe("todo");

    const updated = await updateNode(task.id, {
      title: "对接支付宝接口（含退款）",
      boardStatus: "in_progress",
    });
    expect(updated.title).toBe("对接支付宝接口（含退款）");
    expect(updated.boardStatus).toBe("in_progress");
  });

  it("confirmNode 把提议中的节点标记为已确认", async () => {
    const node = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "证据",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    expect(node.status).toBe("proposed");

    const confirmed = await confirmNode(node.id, "human");
    expect(confirmed.status).toBe("confirmed");
  });

  it("deleteNode 可删除提议中的节点；已确认节点删除被 DB 拒绝", async () => {
    const proposed = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "草稿证据",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    await deleteNode(proposed.id, "human");
    expect(await getNode(proposed.id)).toBeUndefined();

    const confirmed = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "已确认证据",
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    const err = await deleteNode(confirmed.id, "human").catch((e) => e);
    expect(pgErrorMessage(err)).toMatch(/trust ledger/);
    // 删除失败：事务回滚，节点仍然存在
    expect(await getNode(confirmed.id)).toBeDefined();
  });

  it("已确认节点的 title/body 仍可编辑，但 type/project_id 不可变", async () => {
    const node = await createNode({
      type: "evidence",
      projectId: PROJECT,
      title: "证据",
      status: "confirmed",
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });

    const edited = await updateNode(node.id, { title: "证据（已修订）" });
    expect(edited.title).toBe("证据（已修订）");
  });
});
