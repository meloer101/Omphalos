import Link from "next/link";
import { listRoadmapFeatures, type RoadmapStatus } from "@/lib/graph";
import { DEFAULT_PROJECT_ID } from "@/lib/config";

const STATUS_LABELS: Record<RoadmapStatus, string> = {
  planned: "计划中",
  in_progress: "进行中",
  done: "已完成",
};

const STATUS_DOT: Record<RoadmapStatus, string> = {
  planned: "bg-black/20 dark:bg-white/20",
  in_progress: "bg-blue-500",
  done: "bg-green-500",
};

/**
 * Roadmap 视图（Phase1-开工计划.md 1.5，从 P4 提前——纯视图层）：需求
 * 节点按创建时间的时间轴渲染。状态不是手动维护的字段，是从连接的任务
 * 看板状态聚合推导（lib/graph 的 listRoadmapFeatures），跟看板视图
 * 同一套"视图只是已有数据的投影"哲学。
 */
export default async function RoadmapPage() {
  const features = await listRoadmapFeatures(DEFAULT_PROJECT_ID);

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-lg font-medium mb-1">Roadmap</h1>
      <p className="text-xs text-black/40 dark:text-white/40 mb-6">
        需求节点按创建时间排列；状态从它连接的任务看板状态推导，不是单独维护的字段。
      </p>

      {features.length === 0 && (
        <p className="text-sm text-black/40 dark:text-white/40">
          还没有需求节点。
        </p>
      )}

      {features.length > 0 && (
        <ol className="flex flex-col gap-4 border-l border-black/10 dark:border-white/10 pl-4">
          {features.map(({ node, status, taskCount }) => (
            <li key={node.id} className="relative">
              <span
                className={`absolute -left-[21px] top-1.5 w-2 h-2 rounded-full ${STATUS_DOT[status]}`}
              />
              <Link
                href={`/node/${node.id}`}
                className="text-sm font-medium underline"
              >
                {node.title}
              </Link>
              <div className="text-xs text-black/40 dark:text-white/40">
                {STATUS_LABELS[status]}
                {taskCount > 0 && ` · ${taskCount} 张任务卡`}
                {" · "}
                {node.createdAt.toLocaleDateString()}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
