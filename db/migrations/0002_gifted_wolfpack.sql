CREATE TABLE "wallet_grants" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "wallet_grants_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_address" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_grant_day" date;--> statement-breakpoint
ALTER TABLE "wallet_grants" ADD CONSTRAINT "wallet_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tier_allowed" CHECK ("users"."tier" IN ('free', 'creator', 'studio'));