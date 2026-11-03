// Test-only transactional credit ledger simulator. Not a PostgreSQL replacement.
// Disposable PostgreSQL CI separately validates row locks and SQL constraints.
const state = { credits: new Map(), ledger: new Map(), jobs: new Map(), users: new Map(), nextId: 0, failOnce: "" };
const keyFor = (id, request) => id + ":" + request;

export function resetBillingMock() {
  state.credits.clear(); state.ledger.clear(); state.jobs.clear(); state.users.clear(); state.nextId = 0; state.failOnce = "";
}
export function seedBillingCredit(userId, balance, reserved = 0, wallets = {}) {
  state.credits.set(userId, {balance,reserved,
    image_balance:0,image_reserved:0,video_balance:0,video_reserved:0,...wallets});
}
export function billingCredit(userId) {
  const row = state.credits.get(userId);
  // Preserve the legacy two-field public mock contract.
  return row ? { balance:row.balance, reserved:row.reserved } : null;
}
export function billingWallet(userId) {
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
export function seedBillingMockUser(userId,tier="free") {state.users.set(userId,{id:userId,tier});}
export function billingJob(id) { const row = state.jobs.get(id); return row ? {...row} : null; }
export function failNextBillingQuery(sqlFragment) { state.failOnce = sqlFragment; }
function snapshot() {
  return {
    credits: new Map([...state.credits].map(([id, row]) => [id, { ...row }])),
    ledger: new Map([...state.ledger].map(([id, row]) => [id, { ...row }])),
    jobs: new Map([...state.jobs].map(([id, row]) => [id, { ...row }])),
    users: new Map([...state.users].map(([id, row]) => [id, { ...row }])),
    nextId: state.nextId,
  };
}
function restore(saved) {
  state.credits = saved.credits;
  state.ledger = saved.ledger;
  state.jobs = saved.jobs;
  state.users = saved.users;
  state.nextId = saved.nextId;
}
function response(rows = [], rowCount = rows.length) { return { rows, rowCount }; }
async function query(sqlInput, params = []) {
  const sql = String(sqlInput);
  if (state.failOnce && sql.includes(state.failOnce)) {
    state.failOnce = "";
    throw new Error("MOCK_DATABASE_WRITE_FAILED");
  }
  if (sql.includes("INSERT INTO studio_jobs(user_id,ledger_id,modality,model,status,prompt,max_tokens,execution_mode)")) {
    const [userId,ledgerId,modality,model,prompt,maxTokens]=params;
    const id="bbbbbbbb-bbbb-4bbb-8bbb-"+String(++state.nextId).padStart(12,"0");
    const row={id,user_id:userId,ledger_id:ledgerId,modality,model,status:"queued",
      prompt,max_tokens:maxTokens,attempt_count:0,max_attempts:3,lease_token:null,lease_until:null,
      started_at:null,last_error_code:null,result_text:null,usage_in_tokens:null,
      usage_out_tokens:null,result_draft_id:null,execution_mode:"mock",
      provider_job_id:null,created_at:new Date(),finished_at:null};
    state.jobs.set(id,row);
    return response([{...row}]);
  }
  if (sql.includes("SELECT j.*,l.idem_key AS request_id")) {
    const rows=[...state.jobs.values()].filter(j=>{
      const ledger=[...state.ledger.values()].find(l=>l.id===j.ledger_id);
      return j.status==="queued"&&j.execution_mode==="mock"&&j.prompt&&j.max_tokens&&
        j.attempt_count<j.max_attempts&&ledger?.status==="held"&&ledger.reserved_until>Date.now();
    }).map(j=>{
      const l=[...state.ledger.values()].find(x=>x.id===j.ledger_id);
      return {...j,request_id:l.idem_key,reserved_amount:l.reserved_amount,
        price_snapshot:l.price_snapshot,tier:state.users.get(j.user_id)?.tier??"free"};
    });
    return response(rows.slice(0,1));
  }
  if (sql.includes("UPDATE studio_jobs SET status='running',attempt_count=attempt_count+1")) {
    const [id,leaseToken]=params,row=state.jobs.get(id);
    if(!row||row.status!=="queued"||row.attempt_count>=row.max_attempts)return response();
    row.status="running";row.attempt_count++;row.started_at??=new Date();row.lease_token=leaseToken;
    row.lease_until=new Date(Date.now()+60000);row.last_error_code=null;
    return response([{id,attempt_count:row.attempt_count,lease_token:leaseToken,
      lease_until:row.lease_until,status:"running"}]);
  }
  if (sql.includes("SELECT j.attempt_count,j.max_attempts FROM usage_ledger")) {
    const [id,userId,leaseToken]=params,row=state.jobs.get(id);
    const ledger=[...state.ledger.values()].find(l=>l.id===row?.ledger_id);
    if(!row||row.user_id!==userId||row.lease_token!==leaseToken||
      row.status!=="running"||ledger?.status!=="held")return response();
    return response([{attempt_count:row.attempt_count,max_attempts:row.max_attempts}]);
  }
  if (sql.includes("UPDATE studio_jobs SET status=$4,lease_token=NULL")) {
    const [id,userId,leaseToken,status,code]=params,row=state.jobs.get(id);
    if(!row||row.user_id!==userId||row.status!=="running"||row.lease_token!==leaseToken)return response();
    Object.assign(row,{status,lease_token:null,lease_until:null,last_error_code:code,
      finished_at:status==="failed"?new Date():null});
    return response([],1);
  }
  if (sql.includes("SELECT j.id,j.user_id,l.idem_key,j.attempt_count")) {
    const [limit]=params;
    const rows=[...state.jobs.values()].filter(j=>{
      const ledger=[...state.ledger.values()].find(l=>l.id===j.ledger_id);
      return j.status==="running"&&j.execution_mode==="mock"&&
        j.lease_until?.getTime()<Date.now()&&ledger?.status==="held"&&
        ledger.reserved_until>Date.now();
    }).slice(0,limit).map(j=>{
      const l=[...state.ledger.values()].find(x=>x.id===j.ledger_id);
      return {id:j.id,user_id:j.user_id,idem_key:l.idem_key,
        attempt_count:j.attempt_count,max_attempts:j.max_attempts};
    });
    return response(rows);
  }
  if (sql.includes("UPDATE studio_jobs SET status=$2,lease_token=NULL")) {
    const [id,status,code]=params,row=state.jobs.get(id);
    if(!row||row.status!=="running")return response();
    Object.assign(row,{status,lease_token:null,lease_until:null,last_error_code:code,
      finished_at:status==="failed"?new Date():null});
    return response([],1);
  }
  if (sql.includes("INSERT INTO studio_jobs(user_id,ledger_id,modality,model,status)")) {
    const [userId,ledgerId,modality,model] = params;
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-" + String(++state.nextId).padStart(12,"0");
    const row = {id,user_id:userId,ledger_id:ledgerId,modality,model,status:"queued",
      provider_job_id:null,created_at:new Date(),finished_at:null};
    state.jobs.set(id,row);
    return response([{...row}]);
  }
  if (sql.includes("FROM usage_ledger l JOIN studio_jobs j") &&
      sql.includes("FOR UPDATE OF l,j")) {
    const [jobId,userId,requestId] = params;
    const job = state.jobs.get(jobId);
    const ledger = [...state.ledger.values()].find(x=>x.id===job?.ledger_id);
    if (!job || !ledger || job.user_id!==userId || ledger.user_id!==userId ||
        ledger.idem_key!==requestId) return response();
    return response([{...job,ledger_status:ledger.status}]);
  }
  if (sql.includes("FROM usage_ledger l INNER JOIN studio_jobs j")) {
    const [maxAgeSeconds,limit] = params;
    const expired = [...state.jobs.values()].flatMap(job=>{
      const ledger=[...state.ledger.values()].find(x=>x.id===job.ledger_id);
      if (!ledger || ledger.status!=="held" || !["queued","running"].includes(job.status) ||
          ledger.reserved_until>=Date.now() ||
          job.created_at.getTime()>=Date.now()-maxAgeSeconds*1000) return [];
      return [{job_id:job.id,ledger_id:ledger.id,user_id:ledger.user_id,
        modality:ledger.modality,reserved_amount:ledger.reserved_amount}];
    }).slice(0,limit);
    return response(expired);
  }
  if (sql.includes("FROM studio_jobs WHERE id=$1 AND user_id=$2")) {
    const row=state.jobs.get(params[0]);
    return response(row?.user_id===params[1]?[{...row}]:[]);
  }
  if (sql.includes("UPDATE studio_jobs SET status=$3")) {
    const [jobId,userId,status]=params, row=state.jobs.get(jobId);
    if(!row || row.user_id!==userId || !["queued","running"].includes(row.status))
      return response();
    const advanced=sql.includes("lease_token=NULL");
    if(advanced && row.lease_token!==params[3])return response();
    row.status=status;row.finished_at=new Date();
    if(advanced){
      row.result_text=params[4];row.usage_in_tokens=params[5];row.usage_out_tokens=params[6];
      row.lease_token=null;row.lease_until=null;row.last_error_code=null;
    }
    return response([{...row}]);
  }
  if (sql.includes("UPDATE studio_jobs SET status='reclaimed'")) {
    const row=state.jobs.get(params[0]);
    if(!row || !["queued","running"].includes(row.status)) return response();
    row.status="reclaimed";row.finished_at=new Date();
    return response([],1);
  }
  if (sql.includes("INSERT INTO usage_ledger") && sql.includes("ON CONFLICT")) {
    const [userId, requestId, model, reservedAmount, priceSnapshot, modality = "text", ttlSeconds = 120] = params;
    const key = keyFor(userId, requestId);
    if (state.ledger.has(key)) return response();
    const id = "ledger-" + (++state.nextId);
    state.ledger.set(key, {
      id, user_id: userId, idem_key: requestId, model,
      reserved_amount: reservedAmount, settled_amount: 0, price_snapshot: priceSnapshot,
      reserved_until: Date.now() + ttlSeconds * 1000, status: "held", modality,
    });
    return response([{ id }]);
  }
  if (sql.includes("SELECT status, settled_amount, model, reserved_amount")) {
    const row = state.ledger.get(keyFor(params[0], params[1]));
    return response(row ? [row] : []);
  }
  if (sql.includes("UPDATE credits SET image_reserved = image_reserved + $1") ||
      sql.includes("UPDATE credits SET video_reserved = video_reserved + $1")) {
    const [amount,userId]=params;
    const row=state.credits.get(userId);
    const col=sql.includes("image_reserved")?"image_reserved":"video_reserved";
    const balance=col==="image_reserved"?"image_balance":"video_balance";
    if(!row || row[balance]-row[col]<amount)return response();
    row[col]+=amount;
    return response([],1);
  }
  if (sql.includes("UPDATE credits SET image_balance = image_balance - $1") ||
      sql.includes("UPDATE credits SET video_balance = video_balance - $1")) {
    const [charged,reserved,userId]=params;
    const row=state.credits.get(userId);
    const image=sql.includes("image_balance");
    const balance=image?"image_balance":"video_balance";
    const col=image?"image_reserved":"video_reserved";
    if(!row || row[col]<reserved)return response();
    row[balance]-=charged;row[col]-=reserved;
    return response([],1);
  }
  if (sql.includes("UPDATE credits SET image_reserved = image_reserved - $1") ||
      sql.includes("UPDATE credits SET video_reserved = video_reserved - $1") ||
      sql.includes("UPDATE credits SET image_reserved=image_reserved-$1") ||
      sql.includes("UPDATE credits SET video_reserved=video_reserved-$1")) {
    const [reserved,userId]=params;
    const row=state.credits.get(userId);
    const col=sql.includes("image_reserved")?"image_reserved":"video_reserved";
    if(!row || row[col]<reserved)return response();
    row[col]-=reserved;
    return response([],1);
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
  if (sql.includes("SELECT id, status, reserved_amount, settled_amount")) {
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
    if(sql.includes("in_tokens = $3")){row.in_tokens=params[2];row.out_tokens=params[3];}
    return response([], 1);
  }
  if (sql.includes("WHERE status = 'held' AND reserved_until < now()")) {
    return response([...state.ledger.values()]
      .filter(row => row.status === "held" && row.reserved_until < Date.now() &&
        ![...state.jobs.values()].some(job=>job.ledger_id===row.id && ["queued","running"].includes(job.status)))
      .slice(0, params[0]));
  }
  if (sql.includes("UPDATE credits SET reserved = reserved - $1") ||
      sql.includes("UPDATE credits SET reserved=reserved-$1")) {
    const [reserved, userId] = params;
    const row = state.credits.get(userId);
    if (!row || row.reserved < reserved) return response();
    row.reserved -= reserved;
    return response([], 1);
  }
  if (sql.includes("UPDATE usage_ledger SET status = 'reclaimed'") ||
      sql.includes("UPDATE usage_ledger SET status='reclaimed'")) {
    const row = [...state.ledger.values()].find(x => x.id === params[0]);
    if (!row) return response();
    row.status = "reclaimed";
    return response([], 1);
  }
  throw new Error("UNEXPECTED_BILLING_MOCK_SQL");
}
export function getPool() {
  return {
    query,
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
