"use server";

import { revalidatePath } from "next/cache";
import {
  confirmNode,
  deleteNode,
  confirmEdge,
  rejectEdge,
  revertEdge,
} from "@/lib/graph";

/**
 * 审批 tab 的 Server Actions（Phase1-开工计划.md 1.3/1.4，PRD R5）。
 * 单条与整批共用同一套 lib/graph 函数——"整批"只是并发调用"单条"，
 * 不是另一套逻辑，行为保证和单条操作完全一致。
 *
 * `revalidatePath("/", "layout")`（而不是字面量 "/review"）：这些
 * action 从两个地方触发——独立的 /review 页面，和 1.4 收纳同一套渲染
 * 逻辑的侧边栏 tab（由 app/(workbench)/layout.tsx 这个共享布局渲染，
 * 出现在每一个页面）。用户可能在 /inbox 上打开侧边栏点"接受"，这时候
 * 只 revalidate "/review" 不会刷新当前正在渲染的布局；用 'layout'
 * 整个失效范围才能保证不论用户当前在哪个页面，侧边栏拿到的都是最新
 * 数据。
 */

export async function acceptNode(nodeId: string) {
  await confirmNode(nodeId, "human");
  revalidatePath("/", "layout");
}

export async function rejectNode(nodeId: string) {
  await deleteNode(nodeId, "human");
  revalidatePath("/", "layout");
}

export async function acceptEdge(edgeId: string) {
  await confirmEdge(edgeId, "human");
  revalidatePath("/", "layout");
}

export async function rejectPendingEdge(edgeId: string) {
  await rejectEdge(edgeId, "human");
  revalidatePath("/", "layout");
}

/** 撤销一条已自动生效的低风险边（决策 C）。 */
export async function revertConfirmedEdge(edgeId: string) {
  await revertEdge(edgeId, "human");
  revalidatePath("/", "layout");
}

/** 整批接受——批次里的节点和边并发确认。 */
export async function acceptBatch(nodeIds: string[], edgeIds: string[]) {
  await Promise.all([
    ...nodeIds.map((id) => confirmNode(id, "human")),
    ...edgeIds.map((id) => confirmEdge(id, "human")),
  ]);
  revalidatePath("/", "layout");
}

/** 整批拒绝——图无污染，历史留在 audit_log（PRD R3 验收："提议可整体拒绝"）。 */
export async function rejectBatch(nodeIds: string[], edgeIds: string[]) {
  await Promise.all([
    ...nodeIds.map((id) => deleteNode(id, "human")),
    ...edgeIds.map((id) => rejectEdge(id, "human")),
  ]);
  revalidatePath("/", "layout");
}
