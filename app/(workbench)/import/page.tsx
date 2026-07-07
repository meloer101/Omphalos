"use client";

import { useState } from "react";

type Status =
  | { phase: "idle" }
  | { phase: "uploading"; name: string }
  | { phase: "done"; name: string; docCount: number }
  | { phase: "error"; message: string };

/**
 * 冷启动导入页（Phase2-开工计划.md 2.3，PRD R7）。上传历史文档，AI 异步
 * 熔成提议态节点/边，结果进「审批」tab 落图——与捕获同一条审批通路，
 * 这里只管把文件送进 /api/import。
 */
export default function ImportPage() {
  const [status, setStatus] = useState<Status>({ phase: "idle" });

  async function upload(file: File) {
    setStatus({ phase: "uploading", name: file.name });
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "导入失败");
      setStatus({ phase: "done", name: file.name, docCount: data.docCount });
    } catch (err) {
      setStatus({
        phase: "error",
        message: err instanceof Error ? err.message : "导入失败",
      });
    }
  }

  return (
    <div className="max-w-xl mx-auto p-8 flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium">冷启动导入</h1>
        <p className="text-sm text-black/50 dark:text-white/50 mt-1">
          导入团队的历史文档，AI 会把它熔成图里的原生节点和因果边。支持
          Notion 导出包（.zip）、Markdown（.md/.txt）、CSV。
        </p>
      </div>

      <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-black/20 dark:border-white/20 rounded-lg py-10 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5">
        <span className="text-sm text-black/60 dark:text-white/60">
          点击选择文件上传
        </span>
        <span className="text-xs text-black/35 dark:text-white/35">
          .zip / .md / .markdown / .txt / .csv
        </span>
        <input
          type="file"
          accept=".zip,.md,.markdown,.txt,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
      </label>

      {status.phase === "uploading" && (
        <p className="text-sm text-black/50 dark:text-white/50">
          上传中：{status.name}，AI 正在熔图…
        </p>
      )}
      {status.phase === "done" && (
        <p className="text-sm text-black/60 dark:text-white/60">
          {status.name} 已提交，拆成 {status.docCount} 份文档在后台熔图。完成后
          到「审批」tab 确认因果边即可落图。
        </p>
      )}
      {status.phase === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">
          出错了：{status.message}
        </p>
      )}
    </div>
  );
}
