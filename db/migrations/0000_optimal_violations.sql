CREATE TABLE "credits" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credits_reserved_nonnegative" CHECK ("credits"."reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE "model_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(64) NOT NULL,
	"upstream_id" text NOT NULL,
	"tier_min" varchar(32) DEFAULT 'free' NOT NULL,
	"ctx" integer NOT NULL,
	"price_in" numeric(20, 10) NOT NULL,
	"price_out" numeric(20, 10) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "model_registry_ctx_positive" CHECK ("model_registry"."ctx" > 0),
	CONSTRAINT "model_registry_prices_nonnegative" CHECK ("model_registry"."price_in" >= 0 AND "model_registry"."price_out" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sync_blobs" (
	"user_id" uuid NOT NULL,
	"kind" varchar(64) NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_blobs_user_id_kind_pk" PRIMARY KEY("user_id","kind"),
	CONSTRAINT "sync_blobs_version_positive" CHECK ("sync_blobs"."version" >= 1),
	CONSTRAINT "sync_blobs_ciphertext_max_1mb" CHECK (octet_length("sync_blobs"."ciphertext") <= 1048576)
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"idem_key" varchar(128) NOT NULL,
	"type" varchar(24) DEFAULT 'usage' NOT NULL,
	"status" varchar(24) DEFAULT 'held' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"in_tokens" integer DEFAULT 0 NOT NULL,
	"out_tokens" integer DEFAULT 0 NOT NULL,
	"cost" numeric(20, 10) DEFAULT '0' NOT NULL,
	"reserved_amount" integer DEFAULT 0 NOT NULL,
	"settled_amount" integer DEFAULT 0 NOT NULL,
	"price_snapshot" text,
	"reserved_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_ledger_reserved_nonnegative" CHECK ("usage_ledger"."reserved_amount" >= 0),
	CONSTRAINT "usage_ledger_settled_nonnegative" CHECK ("usage_ledger"."settled_amount" >= 0),
	CONSTRAINT "usage_ledger_settled_within_reserved" CHECK ("usage_ledger"."settled_amount" <= "usage_ledger"."reserved_amount"),
	CONSTRAINT "usage_ledger_tokens_nonnegative" CHECK ("usage_ledger"."in_tokens" >= 0 AND "usage_ledger"."out_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"tier" varchar(32) DEFAULT 'free' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"session_epoch" integer DEFAULT 0 NOT NULL,
	"stripe_customer_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_blobs" ADD CONSTRAINT "sync_blobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_user_id_idem_key_unique" ON "usage_ledger" USING btree ("user_id","idem_key");