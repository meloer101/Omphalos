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
