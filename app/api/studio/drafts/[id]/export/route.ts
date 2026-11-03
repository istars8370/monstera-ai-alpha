import { NextRequest, NextResponse } from "next/server";
import { trustedOrigin } from "@/lib/request-origin";
import { studioHttpError, studioNoSession, studioSession, studioWrongOrigin } from "@/lib/studio/http";
import { readStudioJson } from "@/lib/studio/request";
import { exportDraft } from "@/lib/studio/drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{id:string}> };

export async function POST(request: NextRequest, context: Context) {
  if (!trustedOrigin(request,true)) return studioWrongOrigin();
  try {
    const user = await studioSession(request);
    if (!user) return studioNoSession();
    const {id} = await context.params;
    const body = await readStudioJson(request) as Record<string,unknown>;
    const markdown = await exportDraft(user.id,id,body.revision as number);
    return NextResponse.json({markdown},{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return studioHttpError(error); }
}
