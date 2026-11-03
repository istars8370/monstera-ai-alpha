ALTER TABLE "studio_jobs" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "max_tokens" integer;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "last_error_code" varchar(96);--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "result_text" text;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "usage_in_tokens" integer;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "usage_out_tokens" integer;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "result_draft_id" uuid;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD COLUMN "execution_mode" varchar(16) DEFAULT 'mock' NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD CONSTRAINT "studio_jobs_result_draft_id_studio_drafts_id_fk" FOREIGN KEY ("result_draft_id") REFERENCES "public"."studio_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_jobs_lease_idx" ON "studio_jobs" USING btree ("status","lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_jobs_ledger_id_unique" ON "studio_jobs" USING btree ("ledger_id");--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD CONSTRAINT "studio_jobs_attempts_valid" CHECK ("studio_jobs"."attempt_count" >= 0 AND "studio_jobs"."max_attempts" BETWEEN 1 AND 5 AND "studio_jobs"."attempt_count" <= "studio_jobs"."max_attempts");--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD CONSTRAINT "studio_jobs_mock_only" CHECK ("studio_jobs"."execution_mode" = 'mock');--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD CONSTRAINT "studio_jobs_token_limits" CHECK (("studio_jobs"."max_tokens" IS NULL OR "studio_jobs"."max_tokens" BETWEEN 1 AND 16384) AND ("studio_jobs"."usage_in_tokens" IS NULL OR "studio_jobs"."usage_in_tokens" >= 0) AND ("studio_jobs"."usage_out_tokens" IS NULL OR "studio_jobs"."usage_out_tokens" >= 0));