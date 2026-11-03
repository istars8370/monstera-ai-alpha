import { check, index, integer, jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
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
