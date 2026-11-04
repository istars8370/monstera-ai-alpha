import { StudioInputError } from "@/lib/studio/workflow";

/** Mock execution may only touch an explicitly opted-in local disposable database.
 * Neither the Next.js production build nor a public remote DB can opt in. */
export function mockStudioEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production" || env.MONSTERA_STUDIO_MOCK_ENABLED !== "true") return false;
  const url = env.DATABASE_URL;
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "postgresql:" || parsed.protocol === "postgres:") &&
      ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname) &&
      Boolean(parsed.username && parsed.password && parsed.pathname.length > 1);
  } catch { return false; }
}
export function requireMockStudio(env: NodeJS.ProcessEnv = process.env): void {
  if (!mockStudioEnabled(env)) {
    throw new StudioInputError(501, "Mock 생성은 명시적으로 허용된 비운영 로컬 DB에서만 가능합니다.");
  }
}
