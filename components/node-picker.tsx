"use client";

import { useId, useState } from "react";
import type { NodeType } from "@/db/enums";
import { NODE_TYPE_LABELS } from "@/lib/labels";

export interface NodePickerOption {
  id: string;
  title: string;
  type: NodeType;
}

/**
 * 连边表单里的目标节点选择器：选已有节点，或直接输入标题+类型
 * 即时新建。这是让出口验收 demo（需要一个 feature 节点承接
 * supports/implements/validates 三类边）不用先造一个"需求列表页"
 * 就能跑通的最小设计。
 *
 * 不做客户端状态提升——两种模式各自的表单字段直接用 name 属性
 * 提交，切换模式时未显示的一侧字段不会出现在 FormData 里，
 * 服务端 action 用 `mode` 隐藏字段判断走哪个分支。
 */
export function NodePicker({ options }: { options: NodePickerOption[] }) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const groupId = useId();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 text-xs">
        <button
          type="button"
          onClick={() => setMode("existing")}
          className={`px-2 py-1 rounded border ${
            mode === "existing"
              ? "border-black/30 dark:border-white/30 font-medium"
              : "border-transparent text-black/50 dark:text-white/50"
          }`}
        >
          选择已有
        </button>
        <button
          type="button"
          onClick={() => setMode("new")}
          className={`px-2 py-1 rounded border ${
            mode === "new"
              ? "border-black/30 dark:border-white/30 font-medium"
              : "border-transparent text-black/50 dark:text-white/50"
          }`}
        >
          新建节点
        </button>
      </div>

      <input type="hidden" name="targetMode" value={mode} />

      {mode === "existing" ? (
        <select
          name="targetNodeId"
          required
          className="border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-sm bg-transparent"
          aria-labelledby={groupId}
        >
          <option value="">选择目标节点…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              [{NODE_TYPE_LABELS[o.type]}] {o.title}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex gap-2">
          <input
            name="targetNewTitle"
            required
            placeholder="新节点标题"
            className="flex-1 border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-sm bg-transparent"
          />
          <select
            name="targetNewType"
            required
            defaultValue="feature"
            className="border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-sm bg-transparent"
          >
            {Object.entries(NODE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
