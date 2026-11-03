import { getPool } from "@/db/pool";
import { holdCredits, settleCredits, type CreditModality, type HoldInput } from "@/lib/billing";
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
}

export async function getStudioJob(userId:string,id:string):Promise<StudioJob> {
  if(!UUID.test(id))throw new StudioInputError(404,"작업을 찾을 수 없습니다.");
  const result=await getPool().query<StudioJob>(
    "SELECT id,user_id,ledger_id,modality,model,status,provider_job_id,created_at,finished_at FROM studio_jobs WHERE id=$1 AND user_id=$2 LIMIT 1",
    [id,userId],
  );
  if(!result.rows[0])throw new StudioInputError(404,"작업을 찾을 수 없습니다.");
  return result.rows[0];
}

/** Internal admission only. Never expose an unstarted queued job as a successful generation. */
export async function reserveQueuedJob(input:HoldInput & {modality:CreditModality}):Promise<StudioJob> {
  const hold=await holdCredits(input);
  if(hold.status==="insufficient")throw new StudioInputError(402,"크레딧이 부족합니다.");
  if(hold.status!=="held")throw new StudioInputError(409,"중복 요청입니다.");
  try {
    const result=await getPool().query<StudioJob>(
      `INSERT INTO studio_jobs(user_id,ledger_id,modality,model,status)
       VALUES ($1,$2,$3,$4,'queued')
       RETURNING id,user_id,ledger_id,modality,model,status,provider_job_id,created_at,finished_at`,
      [input.userId,hold.ledgerId,input.modality,input.model],
    );
    if(!result.rows[0])throw new Error("STUDIO_JOB_INSERT_FAILED");
    return result.rows[0];
  } catch(error) {
    // If the process dies before this compensation, generic ledger expiry reclaims the orphan hold.
    await settleCredits(input.userId,input.requestId,0).catch(()=>undefined);
    throw error;
  }
}

/** Only trusted provider completion paths may invoke this, never client-supplied charges. */
export async function finalizeStudioJob(userId:string,jobId:string,requestId:string,
  charged:number,succeeded:boolean):Promise<StudioJob> {
  const current=await getStudioJob(userId,jobId);
  if(!["queued","running"].includes(current.status)) {
    throw new StudioInputError(409,"이미 종료된 작업입니다.");
  }
  if(!succeeded && charged!==0)throw new StudioInputError(400,"실패 작업은 0으로 정산합니다.");
  const ledger=await getPool().query<{id:string}>(
    "SELECT id FROM usage_ledger WHERE id=$1 AND user_id=$2 AND idem_key=$3 LIMIT 1",
    [current.ledger_id,userId,requestId],
  );
  if(ledger.rowCount!==1)throw new StudioInputError(409,"작업 예약 정보가 일치하지 않습니다.");
  const settlement=await settleCredits(userId,requestId,charged);
  if(settlement.status!=="settled")throw new StudioInputError(409,"회수됐거나 없는 예약입니다.");
  const result=await getPool().query<StudioJob>(
    `UPDATE studio_jobs SET status=$3,finished_at=now()
     WHERE id=$1 AND user_id=$2 AND status IN ('queued','running',$3)
     RETURNING id,user_id,ledger_id,modality,model,status,provider_job_id,created_at,finished_at`,
    [jobId,userId,succeeded?"succeeded":"failed"],
  );
  if(!result.rows[0])throw new StudioInputError(409,"작업 상태가 변경됐습니다.");
  return result.rows[0];
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
