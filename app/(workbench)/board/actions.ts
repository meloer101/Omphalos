"use server";

import { revalidatePath } from "next/cache";
import { createNode, updateNode } from "@/lib/graph";
import { DEFAULT_PROJECT_ID } from "@/lib/config";
import type { BoardStatus } from "@/db/enums";

export async function createTask(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  await createNode({
    type: "task",
    projectId: DEFAULT_PROJECT_ID,
    title,
    // 默认 proposed，和其他手动创建的节点一致；确认/删除走节点详情页
    // 的通用控件，看板本身只负责卡片+拖拽，不重复一套确认 UI。
    createdBy: "human",
    sourceRef: { kind: "human", detail: {} },
  });

  revalidatePath("/board");
}

export async function updateTaskBoardStatus(
  nodeId: string,
  boardStatus: BoardStatus,
) {
  await updateNode(nodeId, { boardStatus });
  revalidatePath("/board");
}
