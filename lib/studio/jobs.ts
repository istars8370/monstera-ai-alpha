import { getPool } from "@/db/pool";
import { holdCreditsInTransaction, settleCreditsInTransaction, type CreditModality, type HoldInput } from "@/lib/billing";
import { StudioInputError } from "@/lib/studio/workflow";

const wallets = {
  text:{balance:"balance",reserved:"reserved"},
  image:{balance:"image_balance",reserved:"image_reserved"},
  video:{balance:"video_balance",reserved:"video_reserved"},
} as const;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type StudioJobStatus="queued"|"running"|"succeeded"|"failed"|"reclaimed";
export interface StudioJob {
  id:string;user_id:string;ledger_id:string;modality:CreditModality;model:string;
  status:StudioJobStatus;provider_job_id:string|null;created_at:Date;finished_at:Date|null;
  prompt?:string|null;max_tokens?:number|null;attempt_count?:number;max_attempts?:number;
  lease_token?:string|null;lease_until?:Date|null;started_at?:Date|null;
  last_error_code?:string|null;result_text?:string|null;
  usage_in_tokens?:number|null;usage_out_tokens?:number|null;
  result_draft_id?:string|null;execution_mode?:string;
}

export async function getStudioJob(userId:string,id:string):Promise<StudioJob> {
  if(!UUID.test(id))throw new StudioInputError(404,"작업을 찾을 수 없습니다.");
  const result=await getPool().query<StudioJob>(
    "SELECT id,user_id,ledger_id,modality,model,status,provider_job_id,created_at,finished_at,prompt,max_tokens,attempt_count,max_attempts,lease_until,last_error_code,result_text,usage_in_tokens,usage_out_tokens,result_draft_id,execution_mode FROM studio_jobs WHERE id=$1 AND user_id=$2 LIMIT 1",
    [id,userId],
  );
  if(!result.rows[0])throw new StudioInputError(404,"작업을 찾을 수 없습니다.");
  return result.rows[0];
}

/** Reservation and job insertion are an indivisible DB operation. No compensating
 * settlement or catch-up timer is required if insertion fails or the process dies. */
export async function reserveQueuedJob(input: HoldInput & {modality: CreditModality; prompt?:string; maxTokens?:number}): Promise<StudioJob> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const hold = await holdCreditsInTransaction(client, input);
    if (hold.status === "insufficient") throw new StudioInputError(402, "크레딧이 부족합니다.");
    if (hold.status !== "held") throw new StudioInputError(409, "중복 요청입니다.");
    const isGeneration=typeof input.prompt==="string" && input.maxTokens!==undefined;
    if(isGeneration && (input.modality!=="text" || !input.prompt ||
      input.prompt.length>8192 || !Number.isSafeInteger(input.maxTokens) ||
      (input.maxTokens as number)<1 || (input.maxTokens as number)>16384)) {
      throw new StudioInputError(400,"생성 작업 입력을 확인하세요.");
    }
    const result = isGeneration
      ? await client.query<StudioJob>(
        `INSERT INTO studio_jobs(user_id,ledger_id,modality,model,status,prompt,max_tokens,execution_mode)
         VALUES ($1,$2,$3,$4,'queued',$5,$6,'mock')
         RETURNING id,user_id,ledger_id,modality,model,status,provider_job_id,created_at,finished_at`,
        [input.userId,hold.ledgerId,input.modality,input.model,input.prompt,input.maxTokens],
      )
      : await client.query<StudioJob>(
        `INSERT INTO studio_jobs(user_id,ledger_id,modality,model,status)
         VALUES ($1,$2,$3,$4,'queued')
         RETURNING id,user_id,ledger_id,modality,model,status,provider_job_id,created_at,finished_at`,
        [input.userId,hold.ledgerId,input.modality,input.model],
      );
    if (result.rowCount !== 1 || !result.rows[0]) throw new Error("STUDIO_JOB_INSERT_FAILED");
    await client.query("COMMIT");
    return result.rows[0];
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    throw error;
  } finally { client.release(); }
}

/** Trusted worker completion only. Lock ledger and job in the same transaction
 * as the credit charge. Recovery uses the same row locks, preventing double spend
 * even when a worker and a reclaimer complete at the exact same moment. */
export async function finalizeStudioJob(
  userId: string, jobId: string, requestId: string, charged: number, succeeded: boolean,
): Promise<StudioJob> {
  if (!UUID.test(jobId)) throw new StudioInputError(404,"작업을 찾을 수 없습니다.");
  if (!succeeded && charged !== 0) throw new StudioInputError(400, "실패 작업은 0으로 정산합니다.");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<StudioJob & {ledger_status: string}>(
      `SELECT j.id,j.user_id,j.ledger_id,j.modality,j.model,j.status,j.provider_job_id,
        j.created_at,j.finished_at,l.status AS ledger_status
       FROM usage_ledger l JOIN studio_jobs j ON j.ledger_id=l.id
       WHERE j.id=$1 AND j.user_id=$2 AND l.user_id=$2 AND l.idem_key=$3
       FOR UPDATE OF l,j`,
      [jobId,userId,requestId],
    );
    const current = selected.rows[0];
    if (!current) throw new StudioInputError(409,"작업 예약 정보가 일치하지 않습니다.");
    if (!["queued","running"].includes(current.status) || current.ledger_status !== "held") {
      throw new StudioInputError(409,"이미 종료된 작업입니다.");
    }
    const settlement = await settleCreditsInTransaction(client,userId,requestId,charged);
    if (settlement.status !== "settled") throw new Error("JOB_SETTLEMENT_INVARIANT_BROKEN");
    const result = await client.query<StudioJob>(
      `UPDATE studio_jobs SET status=$3,finished_at=now()
       WHERE id=$1 AND user_id=$2 AND status IN ('queued','running')
       RETURNING id,user_id,ledger_id,modality,model,status,provider_job_id,created_at,finished_at`,
      [jobId,userId,succeeded?"succeeded":"failed"],
    );
    if (result.rowCount !== 1 || !result.rows[0]) throw new Error("JOB_STATE_INVARIANT_BROKEN");
    await client.query("COMMIT");
    return result.rows[0];
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    throw error;
  } finally { client.release(); }
}

/** Ledger and job rows are reclaimed atomically with SKIP LOCKED; never based on stream abort. */
export async function reclaimStaleJobs(maxAgeSeconds=0,limit=100):Promise<number> {
  if(!Number.isSafeInteger(maxAgeSeconds)||maxAgeSeconds<0||maxAgeSeconds>86400||
     !Number.isSafeInteger(limit)||limit<1||limit>500)throw new Error("INVALID_RECLAIM_LIMIT");
  const client=await getPool().connect();
  try {
    await client.query("BEGIN");
    const result=await client.query<{job_id:string;ledger_id:string;user_id:string;
      modality:string;reserved_amount:number}>(
      `SELECT j.id AS job_id,l.id AS ledger_id,l.user_id,l.modality,l.reserved_amount
       FROM usage_ledger l INNER JOIN studio_jobs j ON j.ledger_id=l.id
       WHERE l.status='held' AND j.status IN ('queued','running')
         AND l.reserved_until < now()
         AND j.created_at < now() - ($1::int * interval '1 second')
       ORDER BY l.reserved_until
       FOR UPDATE OF l,j SKIP LOCKED LIMIT $2`,
      [maxAgeSeconds,limit],
    );
    for(const item of result.rows) {
      if(item.modality!=="text"&&item.modality!=="image"&&item.modality!=="video")
        throw new Error("INVALID_LEDGER_MODALITY");
      const wallet=wallets[item.modality];
      const credits=await client.query(
        `UPDATE credits SET ${wallet.reserved}=${wallet.reserved}-$1,updated_at=now()
         WHERE user_id=$2 AND ${wallet.reserved}>=$1`,
        [item.reserved_amount,item.user_id],
      );
      if(credits.rowCount!==1)throw new Error("CREDIT_INVARIANT_BROKEN");
      const ledger=await client.query(
        "UPDATE usage_ledger SET status='reclaimed' WHERE id=$1 AND status='held'",
        [item.ledger_id]);
      if(ledger.rowCount!==1)throw new Error("LEDGER_INVARIANT_BROKEN");
      const job=await client.query(
        "UPDATE studio_jobs SET status='reclaimed',finished_at=now() WHERE id=$1 AND status IN ('queued','running')",
        [item.job_id]);
      if(job.rowCount!==1)throw new Error("JOB_INVARIANT_BROKEN");
    }
    await client.query("COMMIT");
    return result.rows.length;
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>undefined);
    throw error;
  } finally{client.release();}
}
