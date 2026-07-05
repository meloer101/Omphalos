"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  confirmNode,
  deleteNode,
  updateNode,
  createNode,
  createEdge,
  confirmEdge,
  rejectEdge,
} from "@/lib/graph";
import { DEFAULT_PROJECT_ID } from "@/lib/config";
import type { EdgeType, NodeType } from "@/db/enums";

function revalidateNode(nodeId: string) {
  revalidatePath(`/node/${nodeId}`);
  revalidatePath("/inbox");
  revalidatePath("/board");
}

export async function confirmThisNode(nodeId: string) {
  await confirmNode(nodeId, "human");
  revalidateNode(nodeId);
}

// redirectTo: 节点被删除后回到哪——evidence/task 各自有列表页，
// feature/outcome 目前没有专门的列表页（Phase 1 才有），先回收件箱。
export async function deleteThisNode(nodeId: string, nodeType: NodeType) {
  await deleteNode(nodeId, "human");
  revalidatePath("/inbox");
  revalidatePath("/board");
  redirect(nodeType === "task" ? "/board" : "/inbox");
}

export async function updateNodeBody(nodeId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const text = String(formData.get("body") ?? "").trim();
  if (!title) return;
  await updateNode(nodeId, { title, body: { text } });
  revalidateNode(nodeId);
}

export async function updateOutcomeBody(nodeId: string, formData: FormData) {
  const metric = String(formData.get("metric") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  await updateNode(nodeId, { body: { metric, value, note } });
  revalidateNode(nodeId);
}

export async function connectEdge(srcId: string, formData: FormData) {
  const edgeType = String(formData.get("edgeType") ?? "") as EdgeType;
  const targetMode = String(formData.get("targetMode") ?? "existing");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!edgeType) return;

  let dstId: string;
  if (targetMode === "new") {
    const newTitle = String(formData.get("targetNewTitle") ?? "").trim();
    const newType = String(formData.get("targetNewType") ?? "") as NodeType;
    if (!newTitle || !newType) return;
    const created = await createNode({
      type: newType,
      projectId: DEFAULT_PROJECT_ID,
      title: newTitle,
      createdBy: "human",
      sourceRef: { kind: "human", detail: {} },
    });
    dstId = created.id;
  } else {
    dstId = String(formData.get("targetNodeId") ?? "");
    if (!dstId) return;
  }

  await createEdge({
    type: edgeType,
    srcId,
    dstId,
    projectId: DEFAULT_PROJECT_ID,
    createdBy: "human",
    sourceRef: { kind: "human", detail: reason ? { note: reason } : {} },
  });

  revalidateNode(srcId);
  revalidateNode(dstId);
}

export async function confirmThisEdge(nodeId: string, edgeId: string) {
  await confirmEdge(edgeId, "human");
  revalidateNode(nodeId);
}

export async function removeThisEdge(nodeId: string, edgeId: string) {
  await rejectEdge(edgeId, "human");
  revalidateNode(nodeId);
}
