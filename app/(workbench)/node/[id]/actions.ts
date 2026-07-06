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
  getNode,
} from "@/lib/graph";
import { DEFAULT_PROJECT_ID } from "@/lib/config";
import type { EdgeType, NodeType } from "@/db/enums";

export interface PrototypeEntry {
  id: string;
  kind: "image" | "figma";
  value: string;
  addedAt: string;
}

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

export async function updateNodeTitle(nodeId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  await updateNode(nodeId, { title });
  revalidateNode(nodeId);
}

/**
 * BlockNote 正文保存——programmatic 调用（不走 <form>，富文本编辑器
 * 本来就依赖 JS，没有渐进增强的必要）。D2 spike 结论见
 * Phase0-开工计划.md：body 存 `{ blocks: BlockNote.Block[] }`。
 *
 * 先读一次现有 body 再合并——1.5 给 feature 节点的 body 加了
 * `prototypes` 这个兄弟字段（画布 tab 用），这里如果直接整体覆盖
 * `{ blocks }` 会把已经贴好的原型图/Figma 链接冲掉。
 */
export async function saveNodeBody(nodeId: string, blocks: unknown) {
  const existing = await getNode(nodeId);
  const existingBody = (existing?.body ?? {}) as Record<string, unknown>;
  await updateNode(nodeId, { body: { ...existingBody, blocks } });
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

/**
 * 原型占位块（Phase1-开工计划.md 1.5，Roadmap.md「画布」tab）：v1 只
 * 支持贴图 / 嵌 Figma 链接，不做 Excalidraw 画布（那是 P5）。存在
 * `body.prototypes` 这个兄弟字段里，跟 BlockNote 的 `body.blocks`
 * 共享同一个 JSONB 列，不需要新迁移。
 */
const MAX_IMAGE_DATA_URL_LENGTH = 2_000_000; // ~1.5MB 原图，base64 编码后的长度上限
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpe?g|gif|webp);base64,/;
const FIGMA_URL_PATTERN = /^https:\/\/(www\.)?figma\.com\//;

async function appendPrototype(
  nodeId: string,
  entry: Pick<PrototypeEntry, "kind" | "value">,
) {
  const node = await getNode(nodeId);
  if (!node) return;
  const body = node.body as { prototypes?: PrototypeEntry[] };
  const prototypes: PrototypeEntry[] = [
    ...(body.prototypes ?? []),
    { id: crypto.randomUUID(), addedAt: new Date().toISOString(), ...entry },
  ];
  await updateNode(nodeId, { body: { ...body, prototypes } });
  revalidateNode(nodeId);
}

/** 客户端已经把剪贴板图片转成 data URL 再调这个——programmatic 调用，不走 <form>。 */
export async function addPrototypeImage(nodeId: string, dataUrl: string) {
  if (!IMAGE_DATA_URL_PATTERN.test(dataUrl) || dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error("不是合法的图片，或者超过了大小上限");
  }
  await appendPrototype(nodeId, { kind: "image", value: dataUrl });
}

export async function addPrototypeFigmaLink(nodeId: string, formData: FormData) {
  const url = String(formData.get("figmaUrl") ?? "").trim();
  if (!FIGMA_URL_PATTERN.test(url)) return;
  await appendPrototype(nodeId, { kind: "figma", value: url });
}

export async function removePrototype(nodeId: string, prototypeId: string) {
  const node = await getNode(nodeId);
  if (!node) return;
  const body = node.body as { prototypes?: PrototypeEntry[] };
  const prototypes = (body.prototypes ?? []).filter((p) => p.id !== prototypeId);
  await updateNode(nodeId, { body: { ...body, prototypes } });
  revalidateNode(nodeId);
}
