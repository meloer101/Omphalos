import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Next.js loads .env.local itself; this is a no-op there but lets
// drizzle-kit / vitest (which run outside the Next.js runtime) see it too.
config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set (see .env.example)");
}

const client = postgres(connectionString);
export const db = drizzle(client, { schema });

/**
 * 只读连接（db/migrations/0003_readonly_role.sql）——检索合同的物理只读
 * 凭证（Agent架构设计.md 5.2）。P1 建好待用，P2 检索合同接入前不会有
 * 消费方。惰性构造，理由同上：独立脚本里 import 提升会跑在 dotenv
 * config() 之前。
 */
let dbReadonlyInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDbReadonly() {
  if (!dbReadonlyInstance) {
    const readonlyUrl = process.env.DATABASE_URL_READONLY;
    if (!readonlyUrl) {
      throw new Error(
        "DATABASE_URL_READONLY is not set (see .env.example)",
      );
    }
    dbReadonlyInstance = drizzle(postgres(readonlyUrl), { schema });
  }
  return dbReadonlyInstance;
}
