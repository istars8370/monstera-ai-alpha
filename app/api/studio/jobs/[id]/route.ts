import { NextRequest, NextResponse } from "next/server";
import { getStudioJob } from "@/lib/studio/jobs";
import { studioHttpError, studioNoSession, studioSession } from "@/lib/studio/http";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{id:string}>};

export async function GET(request:NextRequest,context:Context) {
  try {
    const user=await studioSession(request);
    if(!user)return studioNoSession();
    const {id}=await context.params;
    const job=await getStudioJob(user.id,id);
    return NextResponse.json({job},{headers:{"Cache-Control":"no-store"}});
  } catch(error){return studioHttpError(error);}
}
