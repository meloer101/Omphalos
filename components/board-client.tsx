"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DndContext,
  type DragEndEvent,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import type { Node } from "@/db/schema";
import type { BoardStatus } from "@/db/enums";
import { updateTaskBoardStatus } from "@/app/(workbench)/board/actions";

const COLUMNS: { status: BoardStatus; label: string }[] = [
  { status: "todo", label: "待办" },
  { status: "in_progress", label: "进行中" },
  { status: "done", label: "完成" },
];

function TaskCard({ task }: { task: Node }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        transform: transform
          ? `translate(${transform.x}px, ${transform.y}px)`
          : undefined,
        opacity: isDragging ? 0.4 : 1,
      }}
      className={`p-2.5 rounded border bg-white dark:bg-black cursor-grab active:cursor-grabbing ${
        task.status === "proposed"
          ? "border-dashed border-black/25 dark:border-white/25"
          : "border-black/10 dark:border-white/10"
      }`}
    >
      <Link
        href={`/node/${task.id}`}
        // 拖拽手柄和链接共用同一个元素时，点击应导航、拖动不应触发导航——
        // dnd-kit 的 PointerSensor 默认有位移阈值，短促点击不会被判定为拖拽，
        // 链接点击可以正常穿透。
        className="text-sm block"
        onClick={(e) => {
          if (isDragging) e.preventDefault();
        }}
      >
        {task.title}
      </Link>
      {task.status === "proposed" && (
        <div className="text-xs text-black/40 dark:text-white/40 mt-1">
          提议中
        </div>
      )}
    </div>
  );
}

function Column({
  status,
  label,
  tasks,
}: {
  status: BoardStatus;
  label: string;
  tasks: Node[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-0 p-3 rounded border ${
        isOver
          ? "border-black/30 dark:border-white/30"
          : "border-black/10 dark:border-white/10"
      }`}
    >
      <div className="text-sm font-medium mb-2">
        {label}
        <span className="text-black/40 dark:text-white/40 ml-1">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} />
        ))}
      </div>
    </div>
  );
}

export function BoardClient({ tasks: initialTasks }: { tasks: Node[] }) {
  const [tasks, setTasks] = useState(initialTasks);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const newStatus = over.id as BoardStatus;
    const taskId = active.id as string;

    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, boardStatus: newStatus } : t,
      ),
    );
    void updateTaskBoardStatus(taskId, newStatus);
  }

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div className="flex gap-3">
        {COLUMNS.map((col) => (
          <Column
            key={col.status}
            status={col.status}
            label={col.label}
            tasks={tasks.filter((t) => t.boardStatus === col.status)}
          />
        ))}
      </div>
    </DndContext>
  );
}
