import { NextRequest, NextResponse } from "next/server";

// Fly 헬스체크만 인증 없이 허용한다. 알파 전체는 Basic 인증으로 보호한다.
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/health" || request.nextUrl.pathname === "/api/auth/google/callback") return NextResponse.next();
  const user = process.env.ALPHA_BASIC_USER;
  const password = process.env.ALPHA_BASIC_PASSWORD;
  if (!user || !password) return new NextResponse("Alpha access not configured", { status: 503 });
  const auth = request.headers.get("authorization") ?? "";
  let valid = false;
  if (auth.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6));
      const sep = decoded.indexOf(":");
      const candidateUser = decoded.slice(0, sep);
      const candidatePassword = decoded.slice(sep + 1);
      // 길이가 같은 문자열의 비교를 수행하여 단순 조기 종료를 줄인다.
      const expected = `${user}:${password}`;
      const actual = `${candidateUser}:${candidatePassword}`;
      if (sep >= 0 && expected.length === actual.length) {
        let diff = 0;
        for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
        valid = diff === 0;
      }
    } catch { valid = false; }
  }
  if (valid) return NextResponse.next();
  return new NextResponse("Private alpha", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="MONSTERA AI Alpha"', "Cache-Control": "no-store" } });
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
