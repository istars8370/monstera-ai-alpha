CREATE TABLE "studio_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ledger_id" uuid NOT NULL,
	"modality" varchar(16) NOT NULL,
	"model" varchar(512) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"provider_job_id" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "studio_jobs_modality_allowed" CHECK ("studio_jobs"."modality" IN ('text','image','video','audio')),
	CONSTRAINT "studio_jobs_status_allowed" CHECK ("studio_jobs"."status" IN ('queued','running','succeeded','failed','reclaimed'))
);
--> statement-breakpoint
CREATE TABLE "studio_orders" (
	"order_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"service" varchar(128) NOT NULL,
	"price_krw" integer DEFAULT 0 NOT NULL,
	"paid_krw" integer DEFAULT 0 NOT NULL,
	"cash_cost_krw" integer DEFAULT 0 NOT NULL,
	"labor_minutes" integer DEFAULT 0 NOT NULL,
	"labor_rate_krw" integer DEFAULT 0 NOT NULL,
	"labor_cost_krw" integer DEFAULT 0 NOT NULL,
	"fee_krw" integer DEFAULT 0 NOT NULL,
	"revisions" integer DEFAULT 0 NOT NULL,
	"refund_krw" integer DEFAULT 0 NOT NULL,
	"contribution_krw" integer DEFAULT 0 NOT NULL,
	"external_customer_flag" boolean DEFAULT false NOT NULL,
	"rights_checked" boolean DEFAULT false NOT NULL,
	"delivery_accepted" boolean DEFAULT false NOT NULL,
	"conflict_declared" boolean DEFAULT false NOT NULL,
	"consent_recorded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_orders_revision_positive" CHECK ("studio_orders"."revision" >= 1),
	CONSTRAINT "studio_orders_money_nonnegative" CHECK (
    "studio_orders"."price_krw" >= 0 AND "studio_orders"."paid_krw" >= 0 AND "studio_orders"."cash_cost_krw" >= 0
    AND "studio_orders"."labor_rate_krw" >= 0 AND "studio_orders"."labor_cost_krw" >= 0
    AND "studio_orders"."fee_krw" >= 0 AND "studio_orders"."refund_krw" >= 0),
	CONSTRAINT "studio_orders_minutes_revisions_nonnegative" CHECK ("studio_orders"."labor_minutes" >= 0 AND "studio_orders"."revisions" >= 0),
	CONSTRAINT "studio_orders_refund_within_paid" CHECK ("studio_orders"."refund_krw" <= "studio_orders"."paid_krw"),
	CONSTRAINT "studio_orders_paid_within_price" CHECK ("studio_orders"."paid_krw" <= "studio_orders"."price_krw")
);
--> statement-breakpoint
CREATE TABLE "wallet_grants" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"text_granted" integer DEFAULT 0 NOT NULL,
	"image_granted" integer DEFAULT 0 NOT NULL,
	"video_granted" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_grants_user_id_day_pk" PRIMARY KEY("user_id","day"),
	CONSTRAINT "wallet_grants_nonnegative" CHECK ("wallet_grants"."text_granted" >= 0 AND "wallet_grants"."image_granted" >= 0 AND "wallet_grants"."video_granted" >= 0)
);
--> statement-breakpoint
ALTER TABLE "credits" ADD COLUMN "text_balance" integer GENERATED ALWAYS AS ("balance") STORED;--> statement-breakpoint
ALTER TABLE "credits" ADD COLUMN "text_reserved" integer GENERATED ALWAYS AS ("reserved") STORED;--> statement-breakpoint
ALTER TABLE "credits" ADD COLUMN "image_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credits" ADD COLUMN "image_reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credits" ADD COLUMN "video_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credits" ADD COLUMN "video_reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "modality" varchar(16) DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD CONSTRAINT "studio_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD CONSTRAINT "studio_jobs_ledger_id_usage_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."usage_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_orders" ADD CONSTRAINT "studio_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_grants" ADD CONSTRAINT "wallet_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "studio_jobs_status_created_idx" ON "studio_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "studio_jobs_owner_created_idx" ON "studio_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "studio_orders_owner_updated_idx" ON "studio_orders" USING btree ("user_id","updated_at");--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_modalities_nonnegative" CHECK ("credits"."image_balance" >= 0 AND "credits"."image_reserved" >= 0 AND "credits"."video_balance" >= 0 AND "credits"."video_reserved" >= 0);--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_modality_allowed" CHECK ("usage_ledger"."modality" IN ('text','image','video','audio'));