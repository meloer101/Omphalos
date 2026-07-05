import { listNodesByType } from "@/lib/graph";
import { DEFAULT_PROJECT_ID } from "@/lib/config";
import { BoardClient } from "@/components/board-client";
import { createTask } from "./actions";

export default async function BoardPage() {
  const tasks = await listNodesByType(DEFAULT_PROJECT_ID, "task");

  return (
    <div className="p-6">
      <h1 className="text-lg font-medium mb-4">看板</h1>

      <form action={createTask} className="flex gap-2 mb-6 max-w-md">
        <input
          name="title"
          required
          placeholder="新任务标题"
          className="flex-1 border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-sm bg-transparent"
        />
        <button
          type="submit"
          className="px-3 py-1.5 text-sm rounded border border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5"
        >
          新建任务
        </button>
      </form>

      <BoardClient tasks={tasks} />
    </div>
  );
}
