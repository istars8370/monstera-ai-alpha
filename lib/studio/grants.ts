import { getPool } from "@/db/pool";
import type { Tier } from "@/lib/router";

export interface DailyGrant {text:number;image:number;video:number;}
const MODALITIES=["text","image","video"] as const;
export function grantForTier(tier:Tier,env:NodeJS.ProcessEnv=process.env):DailyGrant {
  const values={} as DailyGrant;
  for(const modality of MODALITIES){
    const key="MONSTERA_DAILY_GRANT_"+tier.toUpperCase()+"_"+modality.toUpperCase();
    const raw=env[key]??"0";
    if(!/^(0|[1-9][0-9]{0,6})$/.test(raw))throw new Error("INVALID_DAILY_GRANT_CONFIG");
    const amount=Number(raw);
    if(!Number.isSafeInteger(amount)||amount>1_000_000)throw new Error("INVALID_DAILY_GRANT_CONFIG");
    values[modality]=amount;
  }
  return values;
}
export async function claimDailyGrant(userId:string,tier:Tier,now=new Date()):Promise<{
  status:"granted"|"already_granted";day:string;amounts:DailyGrant;
}> {
  if(!Number.isFinite(now.getTime()))throw new Error("INVALID_GRANT_DAY");
  const day=now.toISOString().slice(0,10); // UTC boundary, independent of server timezone.
  const amounts=grantForTier(tier);
  const client=await getPool().connect();
  try {
    await client.query("BEGIN");
    const inserted=await client.query(
      `INSERT INTO wallet_grants (user_id,day,text_granted,image_granted,video_granted)
       VALUES ($1,$2::date,$3,$4,$5)
       ON CONFLICT (user_id,day) DO NOTHING RETURNING user_id`,
      [userId,day,amounts.text,amounts.image,amounts.video],
    );
    if(!inserted.rowCount) {
      await client.query("COMMIT");
      return {status:"already_granted",day,amounts:{text:0,image:0,video:0}};
    }
    const credits=await client.query(
      `UPDATE credits SET balance=balance+$1,image_balance=image_balance+$2,
       video_balance=video_balance+$3,updated_at=now() WHERE user_id=$4`,
      [amounts.text,amounts.image,amounts.video,userId],
    );
    if(credits.rowCount!==1)throw new Error("CREDIT_WALLET_MISSING");
    await client.query("COMMIT");
    return {status:"granted",day,amounts};
  } catch(error){
    await client.query("ROLLBACK").catch(()=>undefined);
    throw error;
  } finally{client.release();}
}
