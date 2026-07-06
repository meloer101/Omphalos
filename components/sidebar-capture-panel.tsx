"use client";

import { useState } from "react";

type SubmitStatus = "idle" | "submitting" | "success" | "error";

const inputClass =
  "border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-sm bg-transparent";
const buttonClass =
  "self-start px-3 py-1.5 text-sm rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40";

/**
 * 侧边栏捕获入口（Phase1-开工计划.md 1.4，PRD R3）：把 1.2 已经建好的
 * POST /api/capture/text、/api/capture/file 接上第一个真正的 UI。提交
 * 后立即返回"处理中"——捕获是异步的（0.4 spike：~11s 延迟），这里不
 * 等结果，结果出现在"审批" tab（由 SidebarLiveRefresh 的 SSE 推送触发
 * 自动刷新）。
 */
export function SidebarCapturePanel() {
  const [rawText, setRawText] = useState("");
  const [head, setHead] = useState<"feedback" | "meeting">("feedback");
  const [textStatus, setTextStatus] = useState<SubmitStatus>("idle");
  const [fileStatus, setFileStatus] = useState<SubmitStatus>("idle");
  const [fileName, setFileName] = useState<string | null>(null);

  async function submitText() {
    if (!rawText.trim()) return;
    setTextStatus("submitting");
    try {
      const res = await fetch("/api/capture/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText, head }),
      });
      if (!res.ok) throw new Error(await res.text());
      setRawText("");
      setTextStatus("success");
    } catch {
      setTextStatus("error");
    }
  }

  async function submitFile(file: File) {
    setFileStatus("submitting");
    setFileName(file.name);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("head", head);
      const res = await fetch("/api/capture/file", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      setFileStatus("success");
    } catch {
      setFileStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <label className="text-xs text-black/40 dark:text-white/40 block mb-1">
          来源类型
        </label>
        <select
          value={head}
          onChange={(e) => setHead(e.target.value as "feedback" | "meeting")}
          className={`${inputClass} w-full`}
        >
          <option value="feedback">用户反馈</option>
          <option value="meeting">会议记录</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={6}
          placeholder="粘贴反馈/会议记录原文…"
          className={inputClass}
        />
        <button
          type="button"
          onClick={submitText}
          disabled={textStatus === "submitting" || !rawText.trim()}
          className={buttonClass}
        >
          {textStatus === "submitting" ? "提交中…" : "提交"}
        </button>
        {textStatus === "success" && (
          <p className="text-xs text-black/40 dark:text-white/40">
            已提交，AI 正在处理，完成后会出现在「审批」里。
          </p>
        )}
        {textStatus === "error" && (
          <p className="text-xs text-red-600 dark:text-red-400">
            提交失败，请重试。
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 pt-3 border-t border-black/10 dark:border-white/10">
        <label className="text-xs text-black/40 dark:text-white/40">
          或上传文件（.md / .txt）
        </label>
        <input
          type="file"
          accept=".md,.txt"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void submitFile(file);
            e.target.value = "";
          }}
          className="text-xs"
        />
        {fileStatus === "submitting" && (
          <p className="text-xs text-black/40 dark:text-white/40">
            上传中：{fileName}
          </p>
        )}
        {fileStatus === "success" && (
          <p className="text-xs text-black/40 dark:text-white/40">
            {fileName} 已提交，AI 正在处理。
          </p>
        )}
        {fileStatus === "error" && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {fileName} 上传失败。
          </p>
        )}
      </div>
    </div>
  );
}
