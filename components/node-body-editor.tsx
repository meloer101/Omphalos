"use client";

import "@blocknote/core/fonts/inter.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import type { Block, PartialBlock } from "@blocknote/core";
import { useState } from "react";

/**
 * 需求/证据/任务节点的正文编辑器（D2 spike 结论：BlockNote，见
 * Phase0-开工计划.md）。BlockNote 构造时会摸 window，不能进 SSR
 * 树——调用方必须通过 next/dynamic(ssr:false) 加载这个组件
 * （见 node-body-editor-loader.tsx）。
 */
export function NodeBodyEditor({
  initialBlocks,
  onSave,
}: {
  initialBlocks: Block[] | null;
  onSave: (blocks: Block[]) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const editor = useCreateBlockNote({
    initialContent:
      initialBlocks && initialBlocks.length > 0
        ? initialBlocks
        : ([{ type: "paragraph", content: "" }] as PartialBlock[]),
  });

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(editor.document);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="border border-black/10 dark:border-white/10 rounded p-2">
        <BlockNoteView editor={editor} />
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="self-start px-3 py-1.5 text-sm rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
      >
        {saving ? "保存中…" : "保存"}
      </button>
    </div>
  );
}
