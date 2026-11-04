import { boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usageLedger, users } from "@/db/schema";

// Owner-scoped drafts are not legal attestations or immutable evidence.
export const studioDrafts = pgTable("studio_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, {onDelete: "cascade"}),
  revision: integer("revision").notNull().default(1),
  state: varchar("state", {length:24}).notNull().default("DRAFT"),
  brief: jsonb("brief").notNull(),
  content: jsonb("content").notNull(),
  checks: jsonb("checks"),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", {withTimezone:true}).notNull().defaultNow(),
}, (table) => [
  index("studio_drafts_owner_updated_idx").on(table.userId, table.updatedAt),
  check("studio_drafts_revision_positive",sql`${table.revision} >= 1`),
  check("studio_drafts_state_allowed",sql`${table.state} IN ('DRAFT', 'REVIEW_REQUIRED', 'APPROVED', 'EXPORTED')`),
]);

/** Human-entered private order bookkeeping, wholly separate from service credits. */
export const studioOrders = pgTable("studio_orders", {
  orderId: uuid("order_id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, {onDelete:"cascade"}),
  revision: integer("revision").notNull().default(1),
  service: varchar("service", {length:128}).notNull(),
  priceKrw: integer("price_krw").notNull().default(0),
  paidKrw: integer("paid_krw").notNull().default(0),
  cashCostKrw: integer("cash_cost_krw").notNull().default(0),
  laborMinutes: integer("labor_minutes").notNull().default(0),
  laborRateKrw: integer("labor_rate_krw").notNull().default(0),
  laborCostKrw: integer("labor_cost_krw").notNull().default(0),
  feeKrw: integer("fee_krw").notNull().default(0),
  revisions: integer("revisions").notNull().default(0),
  refundKrw: integer("refund_krw").notNull().default(0),
  contributionKrw: integer("contribution_krw").notNull().default(0),
  externalCustomerFlag: boolean("external_customer_flag").notNull().default(false),
  rightsChecked: boolean("rights_checked").notNull().default(false),
  deliveryAccepted: boolean("delivery_accepted").notNull().default(false),
  conflictDeclared: boolean("conflict_declared").notNull().default(false),
  consentRecorded: boolean("consent_recorded").notNull().default(false),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", {withTimezone:true}).notNull().defaultNow(),
}, (table) => [
  index("studio_orders_owner_updated_idx").on(table.userId, table.updatedAt),
  check("studio_orders_revision_positive",sql`${table.revision} >= 1`),
  check("studio_orders_money_nonnegative",sql`
    ${table.priceKrw} >= 0 AND ${table.paidKrw} >= 0 AND ${table.cashCostKrw} >= 0
    AND ${table.laborRateKrw} >= 0 AND ${table.laborCostKrw} >= 0
    AND ${table.feeKrw} >= 0 AND ${table.refundKrw} >= 0`),
  check("studio_orders_minutes_revisions_nonnegative",sql`${table.laborMinutes} >= 0 AND ${table.revisions} >= 0`),
  check("studio_orders_refund_within_paid",sql`${table.refundKrw} <= ${table.paidKrw}`),
  check("studio_orders_paid_within_price",sql`${table.paidKrw} <= ${table.priceKrw}`),
]);

/** Queue state is durable; request-stream cancellation never settles provider work. */
export const studioJobs = pgTable("studio_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, {onDelete:"cascade"}),
  ledgerId: uuid("ledger_id").notNull().references(() => usageLedger.id),
  modality: varchar("modality", {length:16}).notNull(),
  model: varchar("model", {length:512}).notNull(),
  status: varchar("status", {length:16}).notNull().default("queued"),
  providerJobId: varchar("provider_job_id", {length:512}),
  // Work remains persisted across process restarts; never log stored prompts or results.
  prompt: text("prompt"),
  maxTokens: integer("max_tokens"),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  leaseToken: uuid("lease_token"),
  leaseUntil: timestamp("lease_until", {withTimezone:true}),
  startedAt: timestamp("started_at", {withTimezone:true}),
  lastErrorCode: varchar("last_error_code", {length:96}),
  resultText: text("result_text"),
  usageInTokens: integer("usage_in_tokens"),
  usageOutTokens: integer("usage_out_tokens"),
  resultDraftId: uuid("result_draft_id").references(() => studioDrafts.id, {onDelete:"set null"}),
  // Worker mode cannot accidentally be changed to live without a new reviewed migration.
  executionMode: varchar("execution_mode", {length:16}).notNull().default("mock"),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", {withTimezone:true}),
}, (table) => [
  index("studio_jobs_status_created_idx").on(table.status,table.createdAt),
  index("studio_jobs_owner_created_idx").on(table.userId,table.createdAt),
  index("studio_jobs_lease_idx").on(table.status,table.leaseUntil),
  uniqueIndex("studio_jobs_ledger_id_unique").on(table.ledgerId),
  check("studio_jobs_attempts_valid",sql`${table.attemptCount} >= 0 AND ${table.maxAttempts} BETWEEN 1 AND 5 AND ${table.attemptCount} <= ${table.maxAttempts}`),
  check("studio_jobs_mock_only",sql`${table.executionMode} = 'mock'`),
  check("studio_jobs_token_limits",sql`(${table.maxTokens} IS NULL OR ${table.maxTokens} BETWEEN 1 AND 16384) AND (${table.usageInTokens} IS NULL OR ${table.usageInTokens} >= 0) AND (${table.usageOutTokens} IS NULL OR ${table.usageOutTokens} >= 0)`),
  check("studio_jobs_modality_allowed",sql`${table.modality} IN ('text','image','video','audio')`),
  check("studio_jobs_status_allowed",sql`${table.status} IN ('queued','running','succeeded','failed','reclaimed')`),
]);

/** UTC daily grants are unique per user and calendar day. */
export const walletGrants = pgTable("wallet_grants", {
  userId: uuid("user_id").notNull().references(() => users.id, {onDelete:"cascade"}),
  day: date("day", {mode:"string"}).notNull(),
  textGranted: integer("text_granted").notNull().default(0),
  imageGranted: integer("image_granted").notNull().default(0),
  videoGranted: integer("video_granted").notNull().default(0),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
}, (table) => [
  primaryKey({columns:[table.userId,table.day]}),
  check("wallet_grants_nonnegative",sql`${table.textGranted} >= 0 AND ${table.imageGranted} >= 0 AND ${table.videoGranted} >= 0`),
]);
