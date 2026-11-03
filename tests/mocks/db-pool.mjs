// In-memory query adapter for route-handler tests. Never imported in Next runtime.
// Real SQL uniqueness/rollback is separately tested against disposable PostgreSQL.
const state = { users: new Map(), models: new Map(), credits: new Map(), drafts: new Map(), orders: new Map(), queries: [], sequence: 0 };

export function resetTestDb() {
  state.users.clear(); state.models.clear(); state.credits.clear(); state.drafts.clear(); state.orders.clear(); state.queries.length = 0;
  state.sequence = 0;
}
export function addUser(row) { state.users.set(row.id, { ...row }); }
export function addModel(row) { state.models.set(row.id, { ...row }); }
export function addCredits(userId, balance, reserved = 0) { state.credits.set(userId, { balance, reserved }); }
export function queries() { return [...state.queries]; }
export function findUserByGoogleSub(sub) { return [...state.users.values()].find(row => row.google_sub === sub); }

function duplicate() {
  const error = new Error("MOCK_UNIQUE_VIOLATION");
  error.code = "23505";
  return error;
}
async function query(sqlInput, parameters = []) {
  const sql = String(sqlInput);
  state.queries.push({ sql, parameters });
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
  if (sql.includes("INSERT INTO studio_orders (user_id,service,price_krw")) {
    const [userId,service,price,paid,cash,minutes,rate,labor,fee,revisions,refund,contribution,
      outside,rights,accepted,conflict,consent]=parameters;
    const id="dddddddd-dddd-4ddd-8ddd-"+String(++state.sequence).padStart(12,"0");
    const row={order_id:id,user_id:userId,revision:1,service,price_krw:price,paid_krw:paid,
      cash_cost_krw:cash,labor_minutes:minutes,labor_rate_krw:rate,labor_cost_krw:labor,
      fee_krw:fee,revisions,refund_krw:refund,contribution_krw:contribution,
      external_customer_flag:outside,rights_checked:rights,delivery_accepted:accepted,
      conflict_declared:conflict,consent_recorded:consent,updated_at:new Date()};
    state.orders.set(id,row);
    return {rows:[{...row}],rowCount:1};
  }
  if (sql.includes("FROM studio_orders WHERE user_id=$1 ORDER BY")) {
    const rows=[...state.orders.values()].filter(row=>row.user_id===parameters[0]).slice(0,50);
    return {rows:rows.map(row=>({...row})),rowCount:rows.length};
  }
  if (sql.includes("FROM studio_orders WHERE order_id=$1 AND user_id=$2")) {
    const row=state.orders.get(parameters[0]);
    const match=row?.user_id===parameters[1]?{...row}:undefined;
    return {rows:match?[match]:[],rowCount:match?1:0};
  }
  if (sql.includes("UPDATE studio_orders SET revision=revision+1")) {
    const [id,userId,rev,service,price,paid,cash,minutes,rate,labor,fee,revisions,refund,contribution,
      outside,rights,accepted,conflict,consent]=parameters;
    const row=state.orders.get(id);
    if (!row || row.user_id!==userId || row.revision!==rev) return {rows:[],rowCount:0};
    Object.assign(row,{revision:rev+1,service,price_krw:price,paid_krw:paid,cash_cost_krw:cash,
      labor_minutes:minutes,labor_rate_krw:rate,labor_cost_krw:labor,fee_krw:fee,
      revisions,refund_krw:refund,contribution_krw:contribution,
      external_customer_flag:outside,rights_checked:rights,delivery_accepted:accepted,
      conflict_declared:conflict,consent_recorded:consent,updated_at:new Date()});
    return {rows:[{...row}],rowCount:1};
  }
  if (sql.includes("INSERT INTO studio_drafts (user_id, brief, content)")) {
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-" + String(++state.sequence).padStart(12, "0");
    const row = {id, user_id:parameters[0],revision:1,state:"DRAFT",
      brief:JSON.parse(parameters[1]),content:JSON.parse(parameters[2]),checks:null,
      updated_at:new Date()};
    state.drafts.set(id,row);
    return {rows:[{...row}],rowCount:1};
  }
  if (sql.includes("FROM studio_drafts WHERE user_id = $1 ORDER BY")) {
    const rows=[...state.drafts.values()].filter(row=>row.user_id===parameters[0])
      .sort((a,b)=>b.updated_at.getTime()-a.updated_at.getTime()).slice(0,50);
    return {rows:rows.map(row=>({...row})),rowCount:rows.length};
  }
  if (sql.includes("FROM studio_drafts WHERE id = $1 AND user_id = $2")) {
    const row=state.drafts.get(parameters[0]);
    const match=row?.user_id===parameters[1]?{...row}:undefined;
    return {rows:match?[match]:[],rowCount:match?1:0};
  }
  if (sql.includes("UPDATE studio_drafts")) {
    const [id,userId,revision,status,content,checks,previousRevision]=parameters;
    const row=state.drafts.get(id);
    if (!row || row.user_id!==userId || row.revision!==previousRevision) {
      return {rows:[],rowCount:0};
    }
    Object.assign(row,{revision,state:status,content:JSON.parse(content),checks:checks?JSON.parse(checks):null,
      updated_at:new Date()});
    return {rows:[{...row}],rowCount:1};
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
            sequence: state.sequence,
          };
          return { rows: [], rowCount: null };
        }
        if (sql === "COMMIT") { snapshot = undefined; return { rows: [], rowCount: null }; }
        if (sql === "ROLLBACK") {
          if (snapshot) {
            state.users = snapshot.users;
            state.credits = snapshot.credits;
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
