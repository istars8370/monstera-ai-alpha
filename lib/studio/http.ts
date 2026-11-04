import { NextRequest, NextResponse } from "next/server";
import { authenticatedUser } from "@/lib/auth";
import { StudioInputError } from "@/lib/studio/workflow";

export async function studioSession(request: NextRequest) {
  return authenticatedUser(request);
}
export function studioHttpError(error: unknown): NextResponse {
  if (error instanceof StudioInputError && error.status >= 400 && error.status < 500) {
    return NextResponse.json({ code: "STUDIO_REQUEST_REJECTED" }, {status:error.status,headers:{"Cache-Control":"no-store"}});
  }
  return NextResponse.json({code:"STUDIO_UNAVAILABLE"}, {status:503,headers:{"Cache-Control":"no-store"}});
}
export function studioNoSession(): NextResponse {
  return NextResponse.json({code:"UNAUTHORIZED"},{status:401,headers:{"Cache-Control":"no-store"}});
}
export function studioWrongOrigin(): NextResponse {
  return NextResponse.json({code:"INVALID_ORIGIN"},{status:403,headers:{"Cache-Control":"no-store"}});
}
