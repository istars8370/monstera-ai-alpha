import { NextRequest, NextResponse } from "next/server";
import { trustedOrigin } from "@/lib/request-origin";
import { studioHttpError, studioNoSession, studioSession, studioWrongOrigin } from "@/lib/studio/http";
import { readStudioJson } from "@/lib/studio/request";
import { getDraft, updateDraft } from "@/lib/studio/drafts";
import type { Action } from "@/lib/studio/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{id:string}> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const user = await studioSession(request);
    if (!user) return studioNoSession();
    const {id} = await context.params;
    const draft = await getDraft(user.id,id);
    return NextResponse.json({draft},{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return studioHttpError(error); }
}
export async function PATCH(request: NextRequest, context: Context) {
  if (!trustedOrigin(request,true)) return studioWrongOrigin();
  try {
    const user = await studioSession(request);
    if (!user) return studioNoSession();
    const {id} = await context.params;
    const body = await readStudioJson(request) as Record<string,unknown>;
    const draft = await updateDraft(user.id,id,body.action as Action,body.revision as number,
      {content:body.content,checks:body.checks});
    return NextResponse.json({draft},{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return studioHttpError(error); }
}
