import { getPool } from "@/db/pool";

export type HoldResult =
  | { status: "held"; ledgerId: string }
  | { status: "duplicate_held" | "reclaimed" }
  | { status: "settled"; charged: number }
  | { status: "insufficient" };

export interface HoldInput {
  userId: string;
  requestId: string;
  model: string;
  reserved: number;
  priceSnapshot: string;
}
function validAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
}

// A duplicate key is valid only if it refers to the SAME model, maximum hold and price snapshot.
export function assertCompatibleHold(
  existing: { model: string; reserved_amount: number; price_snapshot: string | null },
  input: HoldInput,
): void {
  if (existing.model !== input.model || existing.reserved_amount !== input.reserved ||
      existing.price_snapshot !== input.priceSnapshot) {
    throw new Error("IDEMPOTENCY_KEY_REUSED");
  }
}

// 모든 예약은 한 트랜잭션에서 멱등 게이트를 먼저 통과한다.
export async function holdCredits(input: HoldInput): Promise<HoldResult> {
  if (!validAmount(input.reserved) || input.reserved === 0 || input.requestId.length > 128 || !input.requestId ||
      !input.model || input.model.length > 512 || !input.priceSnapshot || input.priceSnapshot.length > 4096) throw new Error("INVALID_HOLD");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO usage_ledger (user_id, idem_key, type, status, model, reserved_amount, reserved_until, price_snapshot)
       VALUES ($1, $2, 'usage', 'held', $3, $4, now() + interval '120 seconds', $5)
       ON CONFLICT (user_id, idem_key) DO NOTHING RETURNING id`,
      [input.userId, input.requestId, input.model, input.reserved, input.priceSnapshot],
    );
    if (!inserted.rowCount) {
      const existing = await client.query<{
        status: string; settled_amount: number; model: string; reserved_amount: number; price_snapshot: string | null;
      }>(
        "SELECT status, settled_amount, model, reserved_amount, price_snapshot FROM usage_ledger WHERE user_id = $1 AND idem_key = $2",
        [input.userId, input.requestId],
      );
      const item = existing.rows[0];
      if (!item) throw new Error("LEDGER_CONFLICT_RETRY");
      assertCompatibleHold(item, input);
      await client.query("COMMIT");
      if (item.status === "settled") return { status: "settled", charged: item.settled_amount };
      return { status: item.status === "reclaimed" ? "reclaimed" : "duplicate_held" };
    }
    const reserved = await client.query(
      `UPDATE credits SET reserved = reserved + $1, updated_at = now()
       WHERE user_id = $2 AND balance - reserved >= $1`,
      [input.reserved, input.userId],
    );
    if (!reserved.rowCount) {
      const removed = await client.query("DELETE FROM usage_ledger WHERE id = $1", [inserted.rows[0].id]);
      if (removed.rowCount !== 1) throw new Error("LEDGER_INVARIANT_BROKEN");
      await client.query("COMMIT");
      return { status: "insufficient" };
    }
    await client.query("COMMIT");
    return { status: "held", ledgerId: inserted.rows[0].id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export type SettleResult = { status: "settled"; charged: number } | { status: "reclaimed" | "missing" };

// 취소와 에러에도 수신된 토큰만큼 정산한다. 정산은 중복 실행해도 1회만 반영된다.
export async function settleCredits(userId: string, requestId: string, charged: number): Promise<SettleResult> {
  if (!validAmount(charged)) throw new Error("INVALID_SETTLEMENT");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string; status: string; reserved_amount: number; settled_amount: number }>(
      "SELECT id, status, reserved_amount, settled_amount FROM usage_ledger WHERE user_id = $1 AND idem_key = $2 FOR UPDATE",
      [userId, requestId],
    );
    const item = result.rows[0];
    if (!item) { await client.query("COMMIT"); return { status: "missing" }; }
    if (item.status === "settled") {
      if (item.settled_amount !== charged) throw new Error("SETTLEMENT_REPLAY_MISMATCH");
      await client.query("COMMIT");
      return { status: "settled", charged: item.settled_amount };
    }
    if (item.status !== "held") { await client.query("COMMIT"); return { status: "reclaimed" }; }
    if (charged > item.reserved_amount) throw new Error("SETTLEMENT_EXCEEDS_RESERVATION");
    const updated = await client.query(
      `UPDATE credits SET balance = balance - $1, reserved = reserved - $2, updated_at = now()
       WHERE user_id = $3 AND reserved >= $2`,
      [charged, item.reserved_amount, userId],
    );
    if (updated.rowCount !== 1) throw new Error("CREDIT_INVARIANT_BROKEN");
    const ledgerUpdated = await client.query(
      "UPDATE usage_ledger SET status = 'settled', settled_amount = $1 WHERE id = $2",
      [charged, item.id],
    );
    if (ledgerUpdated.rowCount !== 1) throw new Error("LEDGER_INVARIANT_BROKEN");
    await client.query("COMMIT");
    return { status: "settled", charged };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

// 회수 대상은 행 잠금으로 정산과 직렬화한다. 한 번에 제한된 수만 처리한다.
export async function reclaimExpired(limit = 100): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("INVALID_LIMIT");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const expired = await client.query<{ id: string; user_id: string; reserved_amount: number }>(
      `SELECT id, user_id, reserved_amount FROM usage_ledger
       WHERE status = 'held' AND reserved_until < now()
       ORDER BY reserved_until FOR UPDATE SKIP LOCKED LIMIT $1`, [limit],
    );
    for (const item of expired.rows) {
      const updated = await client.query(
        "UPDATE credits SET reserved = reserved - $1, updated_at = now() WHERE user_id = $2 AND reserved >= $1",
        [item.reserved_amount, item.user_id],
      );
      if (updated.rowCount !== 1) throw new Error("CREDIT_INVARIANT_BROKEN");
      await client.query("UPDATE usage_ledger SET status = 'reclaimed' WHERE id = $1", [item.id]);
    }
    await client.query("COMMIT");
    return expired.rows.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
