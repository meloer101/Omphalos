"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addPrototypeImage } from "@/app/(workbench)/node/[id]/actions";

type Status = "idle" | "submitting" | "error" | "toolarge";

/**
 * "贴图"入口（Phase1-开工计划.md 1.5）：一个只用来接收剪贴板粘贴的
 * 文本框，粘贴图片时在客户端转成 data URL 再调用 Server Action——
 * 不需要额外的对象存储服务，图片直接进 JSONB（P1 规模够用，真正的
 * 附件仓库是以后的事）。粘贴的是文字就忽略，这个框不是给人打字用的。
 */
export function PrototypePasteBox({ nodeId }: { nodeId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");

  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const item = [...event.clipboardData.items].find((i) =>
      i.type.startsWith("image/"),
    );
    if (!item) return;
    event.preventDefault();

    const file = item.getAsFile();
    if (!file) return;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    });

    if (dataUrl.length > 2_000_000) {
      setStatus("toolarge");
      return;
    }

    setStatus("submitting");
    try {
      await addPrototypeImage(nodeId, dataUrl);
      setStatus("idle");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <textarea
        onPaste={handlePaste}
        onChange={() => {}}
        value=""
        rows={2}
        placeholder="点击这里，然后 Ctrl/Cmd+V 粘贴截图"
        className="border border-dashed border-black/20 dark:border-white/20 rounded px-2 py-1.5 text-sm bg-transparent resize-none"
      />
      {status === "submitting" && (
        <p className="text-xs text-black/40 dark:text-white/40">上传中…</p>
      )}
      {status === "error" && (
        <p className="text-xs text-red-600 dark:text-red-400">上传失败，请重试。</p>
      )}
      {status === "toolarge" && (
        <p className="text-xs text-red-600 dark:text-red-400">
          图片太大（上限约 1.5MB），换一张更小的截图。
        </p>
      )}
    </div>
  );
}
