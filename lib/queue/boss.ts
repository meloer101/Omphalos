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
  // P2 语义索引：节点写入后异步向量化（Phase2-开工计划.md 2.1）。
  embed: "embed",
  // P2 冷启动导入：每份历史文档一个 job，worker 并发即并行导入。
  import: "import",
  importDeadLetter: "import_dlq",
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

  // 向量化队列（Phase2-开工计划.md 2.1）：embedding 是派生索引，失败重试
  // 几次即可，不设死信——一个节点暂时没被索引到，只是它在语义检索里
  // 暂时找不到，图本身不受影响，下次正文编辑会再次入队补上。
  await boss.createQueue(QUEUE.embed, { retryLimit: 3, retryDelay: 10 });

  // 导入队列（Phase2-开工计划.md 2.3）：与 capture 同构——每份历史文档
  // 走一遍五段流水线，zod 校验重试耗尽就落死信供人工排查，图无污染。
  await boss.createQueue(QUEUE.importDeadLetter);
  await boss.createQueue(QUEUE.import, {
    retryLimit: 1,
    retryDelay: 5,
    deadLetter: QUEUE.importDeadLetter,
  });

  return boss;
}

export function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = buildBoss();
  }
  return bossPromise;
}
