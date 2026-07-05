CREATE TYPE "public"."board_status" AS ENUM('todo', 'in_progress', 'done');--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "board_status" "board_status" DEFAULT 'todo' NOT NULL;