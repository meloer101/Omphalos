import Link from "next/link";
import { listNodesByType } from "@/lib/graph";
import { DEFAULT_PROJECT_ID } from "@/lib/config";
import { createEvidence, confirmEvidence, deleteEvidence } from "./actions";

export default async function InboxPage() {
  const items = await listNodesByType(DEFAULT_PROJECT_ID, "evidence");
  const sorted = [...items].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-lg font-medium mb-4">反馈收件箱</h1>

      <form
        action={createEvidence}
        className="flex flex-col gap-2 mb-6 p-3 border border-black/10 dark:border-white/10 rounded"
      >
        <input
          name="title"
          required
          placeholder="标题（例如：用户反馈想要微信支付）"
          className="border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-sm bg-transparent"
        />
        <textarea
          name="body"
          placeholder="正文（可选）"
          rows={2}
          className="border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-sm bg-transparent"
        />
        <button
          type="submit"
          className="self-start px-3 py-1.5 text-sm rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5"
        >
          创建证据
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {sorted.map((node) => (
          <li
            key={node.id}
            className={`flex items-center justify-between gap-3 p-3 rounded border ${
              node.status === "proposed"
                ? "border-dashed border-black/25 dark:border-white/25"
                : "border-black/10 dark:border-white/10"
            }`}
          >
            <Link href={`/node/${node.id}`} className="min-w-0 flex-1">
              <div className="text-sm truncate">{node.title}</div>
              <div className="text-xs text-black/40 dark:text-white/40">
                {node.status === "confirmed" ? "已确认" : "提议中"}
              </div>
            </Link>
            <div className="flex gap-2 shrink-0">
              {node.status === "proposed" && (
                <form action={confirmEvidence.bind(null, node.id)}>
                  <button
                    type="submit"
                    className="text-xs px-2 py-1 rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    确认
                  </button>
                </form>
              )}
              {node.status === "proposed" && (
                <form action={deleteEvidence.bind(null, node.id)}>
                  <button
                    type="submit"
                    className="text-xs px-2 py-1 rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    删除
                  </button>
                </form>
              )}
            </div>
          </li>
        ))}
        {sorted.length === 0 && (
          <li className="text-sm text-black/40 dark:text-white/40">
            还没有证据，先创建一条。
          </li>
        )}
      </ul>
    </div>
  );
}
