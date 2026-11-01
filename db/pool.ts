import { Pool, neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";

// Neon의 인터랙티브 트랜잭션은 WebSocket 연결을 사용한다.
neonConfig.webSocketConstructor = WebSocket;
let pool: Pool | undefined;
export function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_NOT_CONFIGURED");
  if (!pool) pool = new Pool({ connectionString: url, max: 5 });
  return pool;
}
