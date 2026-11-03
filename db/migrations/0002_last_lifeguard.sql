CREATE TABLE "studio_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"state" varchar(24) DEFAULT 'DRAFT' NOT NULL,
	"brief" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"checks" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_drafts_revision_positive" CHECK ("studio_drafts"."revision" >= 1),
	CONSTRAINT "studio_drafts_state_allowed" CHECK ("studio_drafts"."state" IN ('DRAFT', 'REVIEW_REQUIRED', 'APPROVED', 'EXPORTED'))
);
--> statement-breakpoint
ALTER TABLE "studio_drafts" ADD CONSTRAINT "studio_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_drafts_owner_updated_idx" ON "studio_drafts" USING btree ("user_id","updated_at");