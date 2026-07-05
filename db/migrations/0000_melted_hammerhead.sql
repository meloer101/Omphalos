CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('proposed', 'confirmed', 'rejected', 'reverted');--> statement-breakpoint
CREATE TYPE "public"."edge_risk" AS ENUM('high', 'low');--> statement-breakpoint
CREATE TYPE "public"."edge_type" AS ENUM('supports', 'implements', 'validates', 'refutes', 'because', 'supersedes', 'duplicates', 'blocks');--> statement-breakpoint
CREATE TYPE "public"."node_type" AS ENUM('evidence', 'feature', 'task', 'outcome');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('proposed', 'confirmed');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"action" "audit_action" NOT NULL,
	"actor" text NOT NULL,
	"edge_type" "edge_type",
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "edge_type" NOT NULL,
	"risk" "edge_risk" NOT NULL,
	"src_id" uuid NOT NULL,
	"dst_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "status" DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "node_type" NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "status" DEFAULT 'proposed' NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edge_id" uuid,
	"node_id" uuid,
	"source_ref" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_src_id_nodes_id_fk" FOREIGN KEY ("src_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_dst_id_nodes_id_fk" FOREIGN KEY ("dst_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance" ADD CONSTRAINT "provenance_edge_id_edges_id_fk" FOREIGN KEY ("edge_id") REFERENCES "public"."edges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance" ADD CONSTRAINT "provenance_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;