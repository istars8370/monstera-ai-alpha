import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/db/pool";
import { studioHttpError, studioNoSession, studioSession } from "@/lib/studio/http";
import { matchStudioCreditPrice } from "@/lib/studio/generation-policy";
import { mockStudioEnabled } from "@/lib/studio/mock-gate";
import { tierRank, type Tier } from "@/lib/router";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:NextRequest) {
  try {
    const user=await studioSession(request);
    if(!user)return studioNoSession();
    const mockEnabled=mockStudioEnabled();
    if(!mockEnabled){
      return NextResponse.json({mockEnabled:false,models:[]},{headers:{"Cache-Control":"no-store"}});
    }
    const result=await getPool().query<{
      id:string;upstream_id:string;provider:string;tier_min:string;
    }>(
      `SELECT id,upstream_id,provider,tier_min FROM model_registry
       WHERE enabled=true AND provider='openai' ORDER BY upstream_id LIMIT 50`,
    );
    const models=result.rows.flatMap(model=>{
      if(model.tier_min!=="free"&&model.tier_min!=="creator"&&model.tier_min!=="studio")return [];
      if(tierRank[user.tier]<tierRank[model.tier_min as Tier])return [];
      try{
        matchStudioCreditPrice(process.env.MONSTERA_STUDIO_TEXT_CREDIT_PRICES_JSON,{
          id:model.id,provider:model.provider,upstreamId:model.upstream_id,
        });
      }catch{return [];}
      return [{id:model.id,label:model.upstream_id,tierMin:model.tier_min}];
    });
    return NextResponse.json({mockEnabled:true,models},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return studioHttpError(error);}
}
