import { NextRequest, NextResponse } from "next/server";
import { trustedOrigin } from "@/lib/request-origin";
import { studioHttpError, studioNoSession, studioSession, studioWrongOrigin } from "@/lib/studio/http";
import { readStudioJson } from "@/lib/studio/request";
import { createDraft, listDrafts } from "@/lib/studio/drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await studioSession(request);
    if (!user) return studioNoSession();
    const drafts = await listDrafts(user.id);
    return NextResponse.json({drafts},{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return studioHttpError(error); }
}
export async function POST(request: NextRequest) {
  if (!trustedOrigin(request,true)) return studioWrongOrigin();
  try {
    const user = await studioSession(request);
    if (!user) return studioNoSession();
    const body = await readStudioJson(request);
    const brief = (body as Record<string,unknown>).brief;
    const draft = await createDraft(user.id,brief);
    return NextResponse.json({draft},{status:201,headers:{"Cache-Control":"no-store"}});
  } catch(error) { return studioHttpError(error); }
}
