import { PgBoss } from "pg-boss";

/**
 * pg-boss 单例（Agent架构设计.md 5.3"编排层自建且薄"；Phase1-开工计划.md
 * 决策 A：只用它跑捕获 job 的异步执行，不建通用多 Agent 事件总线——P1
 * 只有捕获一个 Agent，提前搭事件路由是过度设计）。
 *
 * 惰性构造，理由同 lib/ai/client.ts：独立脚本（worker/index.ts 用 tsx
 * 直接跑）里 import 会被提升到 dotenv config() 之前执行，顶层
 * `new PgBoss()` 会读到空的 DATABASE_URL。
 */

export const QUEUE = {
  capture: "capture",
  captureDeadLetter: "capture_dlq",
} as const;

let bossPromise: Promise<PgBoss> | null = null;

async function buildBoss(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (see .env.example)");
  }
  const boss = new PgBoss({ connectionString });
  await boss.start();

  // 死信队列先建（`deadLetter` 引用时必须已存在），故意不挂 worker——
  // 一个 job 落到这里，说明捕获流水线的 zod 校验重试耗尽（见
  // lib/agents/runtime.ts），只供人工排查，图完全不受影响
  // （"故意投喂垃圾输入，提议可整体拒绝，图无污染"的另一层保险）。
  await boss.createQueue(QUEUE.captureDeadLetter);
  await boss.createQueue(QUEUE.capture, {
    retryLimit: 1,
    retryDelay: 5,
    deadLetter: QUEUE.captureDeadLetter,
  });

  return boss;
}

export function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = buildBoss();
  }
  return bossPromise;
}
