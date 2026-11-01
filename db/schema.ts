import { boolean, integer, numeric, pgTable, primaryKey, timestamp, uuid, varchar, text, customType, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// 서버는 대화 본문을 저장하지 않는다. 동기화 데이터는 암호문만 저장한다.
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() { return "bytea"; },
  toDriver(value) { return Buffer.from(value); },
  fromDriver(value) { return new Uint8Array(value); },
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  tier: varchar("tier", { length: 32 }).notNull().default("free"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  sessionEpoch: integer("session_epoch").notNull().default(0),
  stripeCustomerId: varchar("stripe_customer_id", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const credits = pgTable("credits", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  // 차지백 시 음수 잔액은 허용하되, 신규 예약은 가용 잔액 조건으로 제한한다.
  balance: integer("balance").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("credits_reserved_nonnegative", sql`${table.reserved} >= 0`),
]);

export const usageLedger = pgTable("usage_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  idemKey: varchar("idem_key", { length: 128 }).notNull(),
  type: varchar("type", { length: 24 }).notNull().default("usage"),
  status: varchar("status", { length: 24 }).notNull().default("held"),
  model: text("model").notNull().default(""),
  inTokens: integer("in_tokens").notNull().default(0),
  outTokens: integer("out_tokens").notNull().default(0),
  cost: numeric("cost", { precision: 20, scale: 10 }).notNull().default("0"),
  reservedAmount: integer("reserved_amount").notNull().default(0),
  settledAmount: integer("settled_amount").notNull().default(0),
  priceSnapshot: text("price_snapshot"),
  reservedUntil: timestamp("reserved_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("usage_ledger_user_id_idem_key_unique").on(table.userId, table.idemKey),
  check("usage_ledger_reserved_nonnegative", sql`${table.reservedAmount} >= 0`),
  check("usage_ledger_settled_nonnegative", sql`${table.settledAmount} >= 0`),
  check("usage_ledger_settled_within_reserved", sql`${table.settledAmount} <= ${table.reservedAmount}`),
  check("usage_ledger_tokens_nonnegative", sql`${table.inTokens} >= 0 AND ${table.outTokens} >= 0`),
]);

export const modelRegistry = pgTable("model_registry", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: varchar("provider", { length: 64 }).notNull(),
  upstreamId: text("upstream_id").notNull(),
  tierMin: varchar("tier_min", { length: 32 }).notNull().default("free"),
  ctx: integer("ctx").notNull(),
  priceIn: numeric("price_in", { precision: 20, scale: 10 }).notNull(),
  priceOut: numeric("price_out", { precision: 20, scale: 10 }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
}, (table) => [
  check("model_registry_ctx_positive", sql`${table.ctx} > 0`),
  check("model_registry_prices_nonnegative", sql`${table.priceIn} >= 0 AND ${table.priceOut} >= 0`),
]);

export const syncBlobs = pgTable("sync_blobs", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 64 }).notNull(),
  ciphertext: bytea("ciphertext").notNull(),
  nonce: bytea("nonce").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.kind] }),
  check("sync_blobs_version_positive", sql`${table.version} >= 1`),
  check("sync_blobs_ciphertext_max_1mb", sql`octet_length(${table.ciphertext}) <= 1048576`),
]);
