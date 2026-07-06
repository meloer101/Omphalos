import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getNode,
  getNodeNeighborhood,
  getProvenance,
  listAllNodes,
} from "@/lib/graph";
import { DEFAULT_PROJECT_ID } from "@/lib/config";
import { NODE_TYPE_LABELS, EDGE_TYPE_LABELS } from "@/lib/labels";
import { EDGE_TYPES } from "@/db/enums";
import { NodePicker } from "@/components/node-picker";
import { NodeBodyEditorLoader } from "@/components/node-body-editor-loader";
import type { Block } from "@blocknote/core";
import {
  confirmThisNode,
  deleteThisNode,
  updateNodeTitle,
  saveNodeBody,
  updateOutcomeBody,
  connectEdge,
  confirmThisEdge,
  removeThisEdge,
} from "./actions";

type Tab = "body" | "edges" | "provenance";
const TABS: { id: Tab; label: string }[] = [
  { id: "body", label: "正文" },
  { id: "edges", label: "关联边" },
  { id: "provenance", label: "出处" },
];

/**
 * 节点详情页：中央变形栏。这是"工具即视图"的落地点——同一个
 * 节点，tab 切换出文档编辑面 / 关联边面 / 出处面，而不是三个
 * 独立的工具。Next.js 16：params / searchParams 都是 Promise。
 */
export default async function NodePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = (["body", "edges", "provenance"] as const).includes(
    rawTab as Tab,
  )
    ? (rawTab as Tab)
    : "body";

  const node = await getNode(id);
  if (!node) notFound();

  const [{ outgoing, incoming }, provenance, allNodes] = await Promise.all([
    getNodeNeighborhood(id),
    getProvenance({ nodeId: id }),
    listAllNodes(DEFAULT_PROJECT_ID),
  ]);

  const nodeById = new Map(allNodes.map((n) => [n.id, n]));
  const pickerOptions = allNodes
    .filter((n) => n.id !== id)
    .map((n) => ({ id: n.id, title: n.title, type: n.type }));

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-lg font-medium truncate">{node.title}</h1>
        <div className="flex items-center gap-2 shrink-0 text-xs">
          <span className="text-black/40 dark:text-white/40">
            [{NODE_TYPE_LABELS[node.type]}]
          </span>
          <span className="text-black/40 dark:text-white/40">
            {node.status === "confirmed" ? "已确认" : "提议中"}
          </span>
          {node.status === "proposed" && (
            <>
              <form action={confirmThisNode.bind(null, node.id)}>
                <button
                  type="submit"
                  className="px-2 py-1 rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5"
                >
                  确认
                </button>
              </form>
              <form action={deleteThisNode.bind(null, node.id, node.type)}>
                <button
                  type="submit"
                  className="px-2 py-1 rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5"
                >
                  删除
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <nav className="flex gap-1 mb-4 text-sm border-b border-black/10 dark:border-white/10">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/node/${id}?tab=${t.id}`}
            className={`px-3 py-2 -mb-px border-b-2 ${
              tab === t.id
                ? "border-black dark:border-white font-medium"
                : "border-transparent text-black/50 dark:text-white/50"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "body" &&
        (node.type === "outcome" ? (
          <form
            action={updateOutcomeBody.bind(null, node.id)}
            className="flex flex-col gap-2"
          >
            <label className="text-xs text-black/50 dark:text-white/50">
              指标名称
            </label>
            <input
              name="metric"
              defaultValue={(node.body as { metric?: string })?.metric ?? ""}
              placeholder="例如：支付转化率"
              className="border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-sm bg-transparent"
            />
            <label className="text-xs text-black/50 dark:text-white/50">
              数值
            </label>
            <input
              name="value"
              defaultValue={(node.body as { value?: string })?.value ?? ""}
              placeholder="例如：+12%"
              className="border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-sm bg-transparent"
            />
            <label className="text-xs text-black/50 dark:text-white/50">
              备注
            </label>
            <textarea
              name="note"
              rows={3}
              defaultValue={(node.body as { note?: string })?.note ?? ""}
              className="border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-sm bg-transparent"
            />
            <button
              type="submit"
              className="self-start px-3 py-1.5 text-sm rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5"
            >
              保存
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <form
              action={updateNodeTitle.bind(null, node.id)}
              className="flex gap-2"
            >
              <input
                name="title"
                defaultValue={node.title}
                required
                className="flex-1 border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-sm bg-transparent font-medium"
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-sm rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5"
              >
                改标题
              </button>
            </form>
            <NodeBodyEditorLoader
              initialBlocks={(node.body as { blocks?: Block[] })?.blocks ?? null}
              onSave={saveNodeBody.bind(null, node.id)}
            />
          </div>
        ))}

      {tab === "edges" && (
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-sm font-medium mb-2">出边（本节点 → 其他）</h2>
            <ul className="flex flex-col gap-2">
              {outgoing.map((e) => {
                const target = nodeById.get(e.dstId);
                return (
                  <li
                    key={e.id}
                    className={`flex items-center justify-between gap-2 p-2 rounded border text-sm ${
                      e.status === "proposed"
                        ? "border-dashed border-black/25 dark:border-white/25"
                        : "border-black/10 dark:border-white/10"
                    }`}
                  >
                    <span>
                      <span className="text-black/40 dark:text-white/40">
                        {EDGE_TYPE_LABELS[e.type]} →{" "}
                      </span>
                      {target ? (
                        <Link href={`/node/${target.id}`} className="underline">
                          {target.title}
                        </Link>
                      ) : (
                        "（未知节点）"
                      )}
                      <span className="text-black/40 dark:text-white/40 ml-2">
                        {e.status === "confirmed" ? "已确认" : "提议中"}
                      </span>
                    </span>
                    {e.status === "proposed" && (
                      <span className="flex gap-1 shrink-0">
                        <form action={confirmThisEdge.bind(null, node.id, e.id)}>
                          <button
                            type="submit"
                            className="text-xs px-2 py-0.5 rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5"
                          >
                            确认
                          </button>
                        </form>
                        <form action={removeThisEdge.bind(null, node.id, e.id)}>
                          <button
                            type="submit"
                            className="text-xs px-2 py-0.5 rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5"
                          >
                            移除
                          </button>
                        </form>
                      </span>
                    )}
                  </li>
                );
              })}
              {outgoing.length === 0 && (
                <li className="text-sm text-black/40 dark:text-white/40">
                  暂无出边。
                </li>
              )}
            </ul>
          </div>

          <div>
            <h2 className="text-sm font-medium mb-2">入边（其他 → 本节点）</h2>
            <ul className="flex flex-col gap-2">
              {incoming.map((e) => {
                const source = nodeById.get(e.srcId);
                return (
                  <li
                    key={e.id}
                    className={`p-2 rounded border text-sm ${
                      e.status === "proposed"
                        ? "border-dashed border-black/25 dark:border-white/25"
                        : "border-black/10 dark:border-white/10"
                    }`}
                  >
                    {source ? (
                      <Link href={`/node/${source.id}`} className="underline">
                        {source.title}
                      </Link>
                    ) : (
                      "（未知节点）"
                    )}
                    <span className="text-black/40 dark:text-white/40">
                      {" "}
                      —{EDGE_TYPE_LABELS[e.type]}→ 本节点 ·{" "}
                      {e.status === "confirmed" ? "已确认" : "提议中"}
                    </span>
                  </li>
                );
              })}
              {incoming.length === 0 && (
                <li className="text-sm text-black/40 dark:text-white/40">
                  暂无入边。
                </li>
              )}
            </ul>
          </div>

          <div>
            <h2 className="text-sm font-medium mb-2">连接新边</h2>
            <form
              action={connectEdge.bind(null, node.id)}
              className="flex flex-col gap-2 p-3 border border-black/10 dark:border-white/10 rounded"
            >
              <select
                name="edgeType"
                required
                className="border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-sm bg-transparent"
              >
                <option value="">选择边类型…</option>
                {EDGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {EDGE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <NodePicker options={pickerOptions} />
              <input
                name="reason"
                placeholder="为什么（可选，写入出处）"
                className="border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-sm bg-transparent"
              />
              <button
                type="submit"
                className="self-start px-3 py-1.5 text-sm rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5"
              >
                连接
              </button>
            </form>
          </div>
        </div>
      )}

      {tab === "provenance" && (
        <ul className="flex flex-col gap-2">
          {provenance.map((p) => (
            <li
              key={p.id}
              className="p-2 border border-black/10 dark:border-white/10 rounded text-sm"
            >
              <div>
                创建者：<span className="font-medium">{p.createdBy}</span>
                {p.confidence != null && (
                  <span className="text-black/40 dark:text-white/40">
                    {" "}
                    · 置信度 {p.confidence}
                  </span>
                )}
              </div>
              <div className="text-black/40 dark:text-white/40 text-xs mt-1">
                来源：{JSON.stringify(p.sourceRef)}
              </div>
              <div className="text-black/40 dark:text-white/40 text-xs">
                {p.createdAt.toLocaleString()}
              </div>
            </li>
          ))}
          {provenance.length === 0 && (
            <li className="text-sm text-black/40 dark:text-white/40">
              暂无出处记录。
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
