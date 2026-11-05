// In-memory query adapter for route-handler tests. Never imported in Next runtime.
// Real SQL uniqueness/rollback is separately tested against disposable PostgreSQL.
const state = { users: new Map(), models: new Map(), credits: new Map(), walletGrants: new Set(), queries: [], sequence: 0 };

export function resetTestDb() {
  state.users.clear(); state.models.clear(); state.credits.clear(); state.walletGrants.clear(); state.queries.length = 0;
  state.sequence = 0;
}
export function addUser(row) { state.users.set(row.id, { ...row }); }
export function addModel(row) { state.models.set(row.id, { ...row }); }
export function addCredits(userId, balance, reserved = 0) { state.credits.set(userId, { balance, reserved }); }
export function queries() { return [...state.queries]; }
export function grantDays(userId) { return [...state.walletGrants].filter(key => key.startsWith(userId + ":")); }
export function findUserByGoogleSub(sub) { return [...state.users.values()].find(row => row.google_sub === sub); }

function duplicate() {
  const error = new Error("MOCK_UNIQUE_VIOLATION");
  error.code = "23505";
  return error;
}
async function query(sqlInput, parameters = []) {
  const sql = String(sqlInput);
  state.queries.push({ sql, parameters });
  if (sql.includes("SELECT id, session_epoch FROM users WHERE wallet_address = $1")) {
    const found = [...state.users.values()].find(user => user.wallet_address === parameters[0]);
    return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
  }
  if (sql.startsWith("UPDATE users SET wallet_address = $1")) {
    const [address, userId] = parameters;
    const user = state.users.get(userId);
    if (!user || (user.wallet_address && user.wallet_address !== address)) return { rows: [], rowCount: 0 };
    const owner = [...state.users.values()].find(row => row.wallet_address === address && row.id !== userId);
    if (owner) { const error = duplicate(); throw error; }
    user.wallet_address = address; user.wallet_verified_at = new Date();
    return { rows: [{ id: user.id, session_epoch: user.session_epoch }], rowCount: 1 };
  }
  if (sql.startsWith("UPDATE users SET wallet_verified_at = now()")) {
    const user = state.users.get(parameters[0]);
    if (!user) return { rows: [], rowCount: 0 };
    user.wallet_verified_at = new Date();
    return { rows: [{ id: user.id, session_epoch: user.session_epoch }], rowCount: 1 };
  }
  if (sql.startsWith("SELECT wallet_address FROM users WHERE id = $1")) {
    const user = state.users.get(parameters[0]);
    return { rows: user ? [{ wallet_address: user.wallet_address ?? null }] : [], rowCount: user ? 1 : 0 };
  }
  if (sql.startsWith("UPDATE users SET tier = 'free'")) {
    const user = state.users.get(parameters[0]);
    if (!user) return { rows: [], rowCount: 0 };
    user.tier = "free";
    return { rows: [], rowCount: 1 };
  }
  if (sql.startsWith("UPDATE users SET tier = $1")) {
    const [tier, userId, address] = parameters;
    const user = state.users.get(userId);
    if (!user || user.wallet_address !== address) return { rows: [], rowCount: 0 };
    user.tier = tier;
    return { rows: [], rowCount: 1 };
  }
  if (sql.startsWith("INSERT INTO wallet_grants(")) {
    const key = parameters[0] + ":" + parameters[1];
    if (state.walletGrants.has(key)) return { rows: [], rowCount: 0 };
    state.walletGrants.add(key);
    return { rows: [{ user_id: parameters[0] }], rowCount: 1 };
  }
  if (sql.startsWith("UPDATE credits SET balance = balance + $1")) {
    const [amount, userId] = parameters;
    const credit = state.credits.get(userId);
    if (!credit || credit.balance > 2147483647 - amount) return { rows: [], rowCount: 0 };
    credit.balance += amount;
    return { rows: [], rowCount: 1 };
  }
  if (sql.startsWith("UPDATE users SET last_grant_day = $1")) {
    const [day, userId] = parameters;
    const user = state.users.get(userId);
    if (!user) return { rows: [], rowCount: 0 };
    user.last_grant_day = day;
    return { rows: [], rowCount: 1 };
  }
  if (sql.includes("INSERT INTO users(email, google_sub, email_verified_at)")) {
    const [email, sub] = parameters;
    const matched = findUserByGoogleSub(sub);
    const differentOwner = [...state.users.values()].find(row => row.email === email && row.google_sub !== sub);
    if (differentOwner) throw duplicate();
    if (matched) {
      matched.email = email;
      matched.email_verified_at = new Date();
      return { rows: [{ id: matched.id, session_epoch: matched.session_epoch }], rowCount: 1 };
    }
    const id = "00000000-0000-4000-8000-" + String(++state.sequence).padStart(12, "0");
    const user = { id, email, google_sub: sub, tier: "free", session_epoch: 0, email_verified_at: new Date() };
    state.users.set(id, user);
    return { rows: [{ id, session_epoch: 0 }], rowCount: 1 };
  }
  if (sql.includes("INSERT INTO credits(user_id, balance, reserved)")) {
    if (!state.credits.has(parameters[0])) addCredits(parameters[0], 0);
    return { rows: [], rowCount: 1 };
  }
  if (sql.includes("UPDATE users SET session_epoch = session_epoch + 1")) {
    const user = state.users.get(parameters[0]);
    if (user) user.session_epoch++;
    return { rows: [], rowCount: user ? 1 : 0 };
  }
  if (sql.includes("FROM users WHERE id = $1")) {
    const user = state.users.get(parameters[0]);
    return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
  }
  if (sql.includes("FROM model_registry WHERE id = $1")) {
    const model = state.models.get(parameters[0]);
    return { rows: model?.enabled ? [model] : [], rowCount: model?.enabled ? 1 : 0 };
  }
  if (sql.includes("FROM model_registry WHERE enabled = true AND id = ANY")) {
    const models = [...state.models.values()].filter(m => m.enabled && parameters[0].includes(m.id));
    return { rows: models, rowCount: models.length };
  }
  if (sql.includes("FROM model_registry WHERE enabled = true ORDER BY")) {
    const models = [...state.models.values()].filter(m => m.enabled);
    return { rows: models, rowCount: models.length };
  }
  if (sql.includes("FROM credits WHERE user_id = $1")) {
    const row = state.credits.get(parameters[0]);
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }
  throw new Error("UNEXPECTED_TEST_DATABASE_QUERY: " + sql.slice(0, 160));
}
const pool = {
  query,
  async connect() {
    let snapshot;
    return {
      async query(sql, parameters) {
        if (sql === "BEGIN") {
          snapshot = {
            users: new Map([...state.users].map(([id, user]) => [id, { ...user }])),
            credits: new Map([...state.credits].map(([id, credit]) => [id, { ...credit }])),
            walletGrants: new Set(state.walletGrants),
            sequence: state.sequence,
          };
          return { rows: [], rowCount: null };
        }
        if (sql === "COMMIT") { snapshot = undefined; return { rows: [], rowCount: null }; }
        if (sql === "ROLLBACK") {
          if (snapshot) {
            state.users = snapshot.users;
            state.credits = snapshot.credits;
            state.walletGrants = snapshot.walletGrants;
            state.sequence = snapshot.sequence;
          }
          snapshot = undefined;
          return { rows: [], rowCount: null };
        }
        return query(sql, parameters);
      },
      release() {},
    };
  },
};
export function getPool() { return pool; }
