import { getPool } from "@/db/pool";

export type HoldResult =
  | { status: "held"; ledgerId: string }
  | { status: "duplicate_held" | "reclaimed" }
  | { status: "settled"; charged: number }
  | { status: "insufficient" };

export type CreditModality = "text" | "image" | "video";
const TTL_SECONDS: Record<CreditModality,number> = { text:120, image:600, video:3600 };
const wallets = { text:{balance:"balance",reserved:"reserved"}, image:{balance:"image_balance",reserved:"image_reserved"}, video:{balance:"video_balance",reserved:"video_reserved"} } as const;
function isModality(value:unknown): value is CreditModality { return value==="text"||value==="image"||value==="video"; }

export interface HoldInput {
  modality?: CreditModality;
  ttlSeconds?: number;
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
  existing: { model: string; reserved_amount: number; price_snapshot: string | null; modality?: string },
  input: HoldInput,
): void {
  if (existing.model !== input.model || existing.reserved_amount !== input.reserved ||
      existing.price_snapshot !== input.priceSnapshot ||
      (existing.modality ?? "text") !== (input.modality ?? "text")) {
    throw new Error("IDEMPOTENCY_KEY_REUSED");
  }
}

export type BillingClient = Awaited<ReturnType<ReturnType<typeof getPool>["connect"]>>;

// 모든 예약은 한 트랜잭션에서 멱등 게이트를 먼저 통과한다.
export async function holdCreditsInTransaction(client: BillingClient, input: HoldInput): Promise<HoldResult> {
  const modality=input.modality ?? "text";
  if(!isModality(modality) || (input.ttlSeconds!==undefined && input.ttlSeconds!==TTL_SECONDS[modality])) throw new Error("INVALID_HOLD_TTL");
  const ttlSeconds=TTL_SECONDS[modality];
  const wallet=wallets[modality];
  if (!validAmount(input.reserved) || input.reserved === 0 || input.requestId.length > 128 || !input.requestId ||
      !input.model || input.model.length > 512 || !input.priceSnapshot || input.priceSnapshot.length > 4096) throw new Error("INVALID_HOLD");
  // The caller owns BEGIN/COMMIT; do not acquire a second connection.
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO usage_ledger (user_id, idem_key, type, status, model, reserved_amount, reserved_until, price_snapshot, modality)
       VALUES ($1, $2, 'usage', 'held', $3, $4, now() + ($7::int * interval '1 second'), $5, $6)
       ON CONFLICT (user_id, idem_key) DO NOTHING RETURNING id`,
      [input.userId, input.requestId, input.model, input.reserved, input.priceSnapshot, modality, ttlSeconds],
    );
    if (!inserted.rowCount) {
      const existing = await client.query<{
        status: string; settled_amount: number; model: string; reserved_amount: number; price_snapshot: string | null; modality?: string;
      }>(
        "SELECT status, settled_amount, model, reserved_amount, price_snapshot, modality FROM usage_ledger WHERE user_id = $1 AND idem_key = $2",
        [input.userId, input.requestId],
      );
      const item = existing.rows[0];
      if (!item) throw new Error("LEDGER_CONFLICT_RETRY");
      assertCompatibleHold(item, input);
      
      if (item.status === "settled") return { status: "settled", charged: item.settled_amount };
      return { status: item.status === "reclaimed" ? "reclaimed" : "duplicate_held" };
    }
    const reserved = await client.query(
      `UPDATE credits SET ${wallet.reserved} = ${wallet.reserved} + $1, updated_at = now()
       WHERE user_id = $2 AND ${wallet.balance} - ${wallet.reserved} >= $1`,
      [input.reserved, input.userId],
    );
    if (!reserved.rowCount) {
      const removed = await client.query("DELETE FROM usage_ledger WHERE id = $1", [inserted.rows[0].id]);
      if (removed.rowCount !== 1) throw new Error("LEDGER_INVARIANT_BROKEN");
      
      return { status: "insufficient" };
    }
    
    return { status: "held", ledgerId: inserted.rows[0].id };
}


export async function holdCredits(input: HoldInput): Promise<HoldResult> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await holdCreditsInTransaction(client, input);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export type SettleResult = { status: "settled"; charged: number } | { status: "reclaimed" | "missing" };

// 취소와 에러에도 수신된 토큰만큼 정산한다. 정산은 중복 실행해도 1회만 반영된다.
export async function settleCreditsInTransaction(client: BillingClient, userId: string, requestId: string, charged: number): Promise<SettleResult> {
  if (!validAmount(charged)) throw new Error("INVALID_SETTLEMENT");
  // The caller owns BEGIN/COMMIT; do not acquire a second connection.
    const result = await client.query<{ id: string; status: string; reserved_amount: number; settled_amount: number; modality?: string }>(
      "SELECT id, status, reserved_amount, settled_amount, modality FROM usage_ledger WHERE user_id = $1 AND idem_key = $2 FOR UPDATE",
      [userId, requestId],
    );
    const item = result.rows[0];
    if (!item) {  return { status: "missing" }; }
    if (item.status === "settled") {
      if (item.settled_amount !== charged) throw new Error("SETTLEMENT_REPLAY_MISMATCH");
      
      return { status: "settled", charged: item.settled_amount };
    }
    if (item.status !== "held") {  return { status: "reclaimed" }; }
    if (charged > item.reserved_amount) throw new Error("SETTLEMENT_EXCEEDS_RESERVATION");
    const modality=item.modality ?? "text";
    if (!isModality(modality)) throw new Error("INVALID_LEDGER_MODALITY");
    const wallet=wallets[modality];
    const updated = await client.query(
      `UPDATE credits SET ${wallet.balance} = ${wallet.balance} - $1, ${wallet.reserved} = ${wallet.reserved} - $2, updated_at = now()
       WHERE user_id = $3 AND ${wallet.reserved} >= $2`,
      [charged, item.reserved_amount, userId],
    );
    if (updated.rowCount !== 1) throw new Error("CREDIT_INVARIANT_BROKEN");
    const ledgerUpdated = await client.query(
      "UPDATE usage_ledger SET status = 'settled', settled_amount = $1 WHERE id = $2",
      [charged, item.id],
    );
    if (ledgerUpdated.rowCount !== 1) throw new Error("LEDGER_INVARIANT_BROKEN");
    
    return { status: "settled", charged };
}


export async function settleCredits(userId: string, requestId: string, charged: number): Promise<SettleResult> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await settleCreditsInTransaction(client, userId, requestId, charged);
    await client.query("COMMIT");
    return result;
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
    const expired = await client.query<{ id: string; user_id: string; reserved_amount: number; modality?: string }>(
      `SELECT id, user_id, reserved_amount, modality FROM usage_ledger
       WHERE status = 'held' AND reserved_until < now()
         AND NOT EXISTS (SELECT 1 FROM studio_jobs j WHERE j.ledger_id = usage_ledger.id
           AND j.status IN ('queued','running'))
       ORDER BY reserved_until FOR UPDATE SKIP LOCKED LIMIT $1`, [limit],
    );
    for (const item of expired.rows) {
      const modality=item.modality ?? "text";
      if(!isModality(modality)) throw new Error("INVALID_LEDGER_MODALITY");
      const wallet=wallets[modality];
      const updated = await client.query(
        `UPDATE credits SET ${wallet.reserved} = ${wallet.reserved} - $1, updated_at = now() WHERE user_id = $2 AND ${wallet.reserved} >= $1`,
        [item.reserved_amount, item.user_id],
      );
      if (updated.rowCount !== 1) throw new Error("CREDIT_INVARIANT_BROKEN");
      const ledgerUpdated = await client.query(
        "UPDATE usage_ledger SET status = 'reclaimed' WHERE id = $1 AND status = 'held'",
        [item.id],
      );
      if (ledgerUpdated.rowCount !== 1) throw new Error("LEDGER_INVARIANT_BROKEN");
    }
    await client.query("COMMIT");
    return expired.rows.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
