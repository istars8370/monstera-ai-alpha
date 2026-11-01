// In-memory data adapter for route-handler integration tests; NEVER used in Next runtime.
const state = { users: new Map(), models: new Map(), credits: new Map(), queries: [] };

export function resetTestDb() {
  state.users.clear(); state.models.clear(); state.credits.clear(); state.queries.length = 0;
}
export function addUser(row) { state.users.set(row.id, { ...row }); }
export function addModel(row) { state.models.set(row.id, { ...row }); }
export function addCredits(userId, balance, reserved = 0) { state.credits.set(userId, { balance, reserved }); }
export function queries() { return [...state.queries]; }

const pool = {
  async query(query, parameters = []) {
    const sql = String(query);
    state.queries.push({ sql, parameters });
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
    throw new Error("UNEXPECTED_TEST_DATABASE_QUERY: " + sql.slice(0,160));
  },
};
export function getPool() { return pool; }
