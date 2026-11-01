import { Pool, neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";

// Interactive Neon transactions require WebSocket transport. Keep credentials server-side.
neonConfig.webSocketConstructor = WebSocket;

export function validateDatabaseUrl(value: string | undefined, production = false): string {
  if (!value) throw new Error("DATABASE_URL_NOT_CONFIGURED");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("INVALID_DATABASE_URL"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname ||
      !parsed.username || !parsed.password || !parsed.pathname || parsed.pathname === "/" ||
      parsed.hash) throw new Error("INVALID_DATABASE_URL");
  if (production && parsed.searchParams.get("sslmode") === "disable") {
    throw new Error("DATABASE_TLS_REQUIRED");
  }
  return value;
}

let pool: Pool | undefined;
export function getPool(): Pool {
  if (!pool) {
    const url = validateDatabaseUrl(process.env.DATABASE_URL, process.env.NODE_ENV === "production");
    pool = new Pool({
      connectionString: url,
      max: 5,
      connectionTimeoutMillis: 6000,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}
