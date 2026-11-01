// Test-only transactional credit ledger simulator. Not a PostgreSQL replacement.
// Disposable PostgreSQL CI separately validates row locks and SQL constraints.
const state = { credits: new Map(), ledger: new Map(), nextId: 0, failOnce: "" };
const keyFor = (id, request) => id + ":" + request;

export function resetBillingMock() {
  state.credits.clear(); state.ledger.clear(); state.nextId = 0; state.failOnce = "";
}
export function seedBillingCredit(userId, balance, reserved = 0) {
  state.credits.set(userId, { balance, reserved });
}
export function billingCredit(userId) {
  const row = state.credits.get(userId);
  return row ? { ...row } : null;
}
export function billingLedger(userId, requestId) {
  const row = state.ledger.get(keyFor(userId, requestId));
  return row ? { ...row } : null;
}
export function expireBillingLedger(userId, requestId) {
  const row = state.ledger.get(keyFor(userId, requestId));
  if (row) row.reserved_until = Date.now() - 10000;
}
export function failNextBillingQuery(sqlFragment) { state.failOnce = sqlFragment; }
function snapshot() {
  return {
    credits: new Map([...state.credits].map(([id, row]) => [id, { ...row }])),
    ledger: new Map([...state.ledger].map(([id, row]) => [id, { ...row }])),
    nextId: state.nextId,
  };
}
function restore(saved) {
  state.credits = saved.credits;
  state.ledger = saved.ledger;
  state.nextId = saved.nextId;
}
function response(rows = [], rowCount = rows.length) { return { rows, rowCount }; }
async function query(sqlInput, params = []) {
  const sql = String(sqlInput);
  if (state.failOnce && sql.includes(state.failOnce)) {
    state.failOnce = "";
    throw new Error("MOCK_DATABASE_WRITE_FAILED");
  }
  if (sql.includes("INSERT INTO usage_ledger") && sql.includes("ON CONFLICT")) {
    const [userId, requestId, model, reservedAmount, priceSnapshot] = params;
    const key = keyFor(userId, requestId);
    if (state.ledger.has(key)) return response();
    const id = "ledger-" + (++state.nextId);
    state.ledger.set(key, {
      id, user_id: userId, idem_key: requestId, model,
      reserved_amount: reservedAmount, settled_amount: 0, price_snapshot: priceSnapshot,
      reserved_until: Date.now() + 120000, status: "held",
    });
    return response([{ id }]);
  }
  if (sql.includes("SELECT status, settled_amount, model, reserved_amount")) {
    const row = state.ledger.get(keyFor(params[0], params[1]));
    return response(row ? [row] : []);
  }
  if (sql.includes("UPDATE credits SET reserved = reserved + $1")) {
    const [amount, userId] = params;
    const row = state.credits.get(userId);
    if (!row || row.balance - row.reserved < amount) return response();
    row.reserved += amount;
    return response([], 1);
  }
  if (sql.includes("DELETE FROM usage_ledger WHERE id = $1")) {
    let removed = 0;
    for (const [key, row] of state.ledger) {
      if (row.id === params[0]) { state.ledger.delete(key); removed++; }
    }
    return response([], removed);
  }
  if (sql.includes("SELECT id, status, reserved_amount, settled_amount FROM usage_ledger")) {
    const row = state.ledger.get(keyFor(params[0], params[1]));
    return response(row ? [row] : []);
  }
  if (sql.includes("UPDATE credits SET balance = balance - $1, reserved = reserved - $2")) {
    const [charged, reserved, userId] = params;
    const row = state.credits.get(userId);
    if (!row || row.reserved < reserved) return response();
    row.balance -= charged;
    row.reserved -= reserved;
    return response([], 1);
  }
  if (sql.includes("UPDATE usage_ledger SET status = 'settled'")) {
    const [charged, ledgerId] = params;
    const row = [...state.ledger.values()].find(x => x.id === ledgerId);
    if (!row) return response();
    row.status = "settled"; row.settled_amount = charged;
    return response([], 1);
  }
  if (sql.includes("WHERE status = 'held' AND reserved_until < now()")) {
    return response([...state.ledger.values()]
      .filter(row => row.status === "held" && row.reserved_until < Date.now())
      .slice(0, params[0]));
  }
  if (sql.includes("UPDATE credits SET reserved = reserved - $1")) {
    const [reserved, userId] = params;
    const row = state.credits.get(userId);
    if (!row || row.reserved < reserved) return response();
    row.reserved -= reserved;
    return response([], 1);
  }
  if (sql.includes("UPDATE usage_ledger SET status = 'reclaimed'")) {
    const row = [...state.ledger.values()].find(x => x.id === params[0]);
    if (!row) return response();
    row.status = "reclaimed";
    return response([], 1);
  }
  throw new Error("UNEXPECTED_BILLING_MOCK_SQL");
}
export function getPool() {
  return {
    async connect() {
      let transaction;
      return {
        async query(sql, params) {
          if (sql === "BEGIN") { transaction = snapshot(); return response(); }
          if (sql === "COMMIT") { transaction = undefined; return response(); }
          if (sql === "ROLLBACK") {
            if (transaction) restore(transaction);
            transaction = undefined;
            return response();
          }
          return query(sql, params);
        },
        release() {},
      };
    },
  };
}
