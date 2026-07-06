"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  parseCitedAnswer,
  type AnswerSegment,
  type CitationSource,
} from "@/lib/retrieval/cite";
import { NODE_TYPE_LABELS } from "@/lib/labels";

/**
 * 全局追溯搜索栏（Phase2-开工计划.md 2.2，PRD R4）。⌘K/Ctrl-K 唤起，
 * 问一句"X 当初为什么"，流式吐出自然语言答案，引用以行内蓝链嵌在句子里
 * （非"来源"列表——Roadmap 2.2 交互备忘）。
 *
 * 只在 AI 侧边栏打开时挂载（workbench-chrome 控制）：Cmd-K 是"AI 露面"，
 * 归侧边栏开关语义，关闭态整体退场保 G5 降级完整性。
 *
 * 引用护栏在服务端 answer.ts + 客户端 cite.ts 两处成立：服务端只把可达
 * 节点的句柄喂给模型，这里用同一份 sources 重建句柄映射，parseCitedAnswer
 * 把模型吐出的非法句柄就地剥离——错误引用永远到不了用户眼前。
 */

type State =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "no_record" }
  | { phase: "answer"; segments: AnswerSegment[]; scope: "local" | "global" }
  | { phase: "error"; message: string };

function buildHandleMap(sources: CitationSource[]): Map<string, CitationSource> {
  return new Map(sources.map((s) => [s.handle, s]));
}

export function CmdKSearch() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  // 全局快捷键：⌘K / Ctrl-K 开关；Esc 关闭。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const ask = useCallback(async () => {
    const q = question.trim();
    if (!q) return;
    setState({ phase: "loading" });

    try {
      const res = await fetch("/api/retrieval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });

      // no_record 是普通 JSON；answer 是"首行元数据 + 流式正文"。
      const contentType = res.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        setState(data?.kind === "no_record" ? { phase: "no_record" } : {
          phase: "error",
          message: data?.error ?? "检索失败",
        });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setState({ phase: "error", message: "无响应流" });
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let handles: Map<string, CitationSource> | null = null;
      let scope: "local" | "global" = "local";
      let answerText = "";

      // 第一行是单行 JSON 元数据，`\n` 之后全是答案原文。
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });

        if (!handles) {
          const nl = buffer.indexOf("\n");
          if (nl === -1) {
            if (done) break;
            continue;
          }
          const meta = JSON.parse(buffer.slice(0, nl));
          handles = buildHandleMap(meta.sources ?? []);
          scope = meta.scope ?? "local";
          answerText = buffer.slice(nl + 1);
        } else {
          answerText = buffer.slice(buffer.indexOf("\n") + 1);
        }

        const { segments } = parseCitedAnswer(answerText, handles);
        setState({ phase: "answer", segments, scope });

        if (done) break;
      }
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "检索出错",
      });
    }
  }, [question]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl mx-4 rounded-lg border border-black/10 dark:border-white/15 bg-white dark:bg-neutral-900 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
          className="flex items-center gap-2 border-b border-black/10 dark:border-white/10 px-4"
        >
          <span className="text-black/30 dark:text-white/30 text-sm">追溯</span>
          <input
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="问一句「X 当初为什么…」，回车检索"
            className="flex-1 bg-transparent py-3 text-sm outline-none"
          />
        </form>

        <div className="max-h-[50vh] overflow-auto px-4 py-3 text-sm leading-relaxed">
          {state.phase === "idle" && (
            <p className="text-black/40 dark:text-white/40">
              回答只依据图里已确认的节点，每句挂可点击的深链；图里没有就直说没有。
            </p>
          )}
          {state.phase === "loading" && (
            <p className="text-black/40 dark:text-white/40">检索中…</p>
          )}
          {state.phase === "no_record" && (
            <p className="text-black/60 dark:text-white/60">图里没有记录。</p>
          )}
          {state.phase === "error" && (
            <p className="text-red-600 dark:text-red-400">出错了：{state.message}</p>
          )}
          {state.phase === "answer" && (
            <div>
              {state.scope === "global" && (
                <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
                  本项目没有记录，以下来自其它项目的相关内容。
                </p>
              )}
              <p className="whitespace-pre-wrap">
                {state.segments.map((seg, i) =>
                  seg.kind === "text" ? (
                    <span key={i}>{seg.text}</span>
                  ) : (
                    <Link
                      key={i}
                      href={`/node/${seg.id}`}
                      className="text-blue-600 dark:text-blue-400 underline decoration-dotted underline-offset-2 hover:decoration-solid"
                      title={`${NODE_TYPE_LABELS[seg.nodeType]}：${seg.title}`}
                    >
                      {seg.title}
                    </Link>
                  ),
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
