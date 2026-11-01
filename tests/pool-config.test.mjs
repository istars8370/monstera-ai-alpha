import test from "node:test";
import assert from "node:assert/strict";
import { validateDatabaseUrl, getPool } from "../db/pool.ts";

test("database preflight rejects missing or malformed URLs without leaking credentials", () => {
  for (const invalid of [
    undefined, "", "not-a-postgres-url", "https://user:pass@example.com/db",
    "postgresql://example.com/db", "postgresql://u:p@example.com/",
    "postgresql://u:p@example.com/db#fragment",
  ]) assert.throws(() => validateDatabaseUrl(invalid), /DATABASE_URL_NOT_CONFIGURED|INVALID_DATABASE_URL/);
});

test("database preflight permits isolated test URLs and enforces TLS in production", () => {
  const testUrl = "postgresql://disposable:test@localhost:5432/test_db";
  assert.equal(validateDatabaseUrl(testUrl, false), testUrl);
  assert.equal(validateDatabaseUrl("postgresql://demo:secret@example.neon.tech/db?sslmode=require", true),
    "postgresql://demo:secret@example.neon.tech/db?sslmode=require");
  assert.throws(() => validateDatabaseUrl(testUrl + "?sslmode=disable", true), /DATABASE_TLS_REQUIRED/);
});

test("missing DB credentials fail before acquiring or querying any pool", () => {
  const before = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    assert.throws(() => getPool(), /DATABASE_URL_NOT_CONFIGURED/);
  } finally {
    if (before === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = before;
  }
});
