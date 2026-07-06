"use client";

import dynamic from "next/dynamic";
import type { Block } from "@blocknote/core";

const NodeBodyEditor = dynamic(
  () => import("./node-body-editor").then((m) => m.NodeBodyEditor),
  { ssr: false },
);

export function NodeBodyEditorLoader({
  initialBlocks,
  onSave,
}: {
  initialBlocks: Block[] | null;
  onSave: (blocks: Block[]) => Promise<void>;
}) {
  return <NodeBodyEditor initialBlocks={initialBlocks} onSave={onSave} />;
}
