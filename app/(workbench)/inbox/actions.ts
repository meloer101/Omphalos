"use server";

import { revalidatePath } from "next/cache";
import { createNode, confirmNode, deleteNode } from "@/lib/graph";
import { DEFAULT_PROJECT_ID } from "@/lib/config";

export async function createEvidence(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const text = String(formData.get("body") ?? "").trim();
  if (!title) return;

  await createNode({
    type: "evidence",
    projectId: DEFAULT_PROJECT_ID,
    title,
    body: { text },
    createdBy: "human",
    sourceRef: { kind: "human", detail: {} },
  });

  revalidatePath("/inbox");
}

export async function confirmEvidence(nodeId: string) {
  await confirmNode(nodeId, "human");
  revalidatePath("/inbox");
}

export async function deleteEvidence(nodeId: string) {
  await deleteNode(nodeId, "human");
  revalidatePath("/inbox");
}
