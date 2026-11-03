import { boolean, check, index, integer, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "@/db/schema";

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
