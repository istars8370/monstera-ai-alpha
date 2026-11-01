// Offline readiness inspection only. Does not query providers, connect to Neon, or print secrets.
import { pathToFileURL } from "node:url";

function validUrl(value, protocols, allowLocal = false) {
  try {
    const parsed = new URL(value);
    const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
    return (protocols.includes(parsed.protocol) || (allowLocal && local && parsed.protocol === "http:")) &&
      Boolean(parsed.hostname) && parsed.pathname === "/" && !parsed.hash && !parsed.username && !parsed.password;
  } catch { return false; }
}
function validDatabaseUrl(value) {
  try {
    const parsed = new URL(value);
    return ["postgres:", "postgresql:"].includes(parsed.protocol) &&
      !!parsed.username && !!parsed.password && !!parsed.hostname &&
      parsed.pathname.length > 1 && parsed.searchParams.get("sslmode") !== "disable" &&
      !["localhost", "127.0.0.1"].includes(parsed.hostname);
  } catch { return false; }
}
function validRateCap(value) {
  return typeof value === "string" && /^[1-9]\d*$/.test(value) &&
    Number.isSafeInteger(Number(value)) && Number(value) <= 1000;
}
export function inspectIntegrationConfig(env = process.env) {
  const origin = env.MONSTERA_PUBLIC_ORIGIN;
  const checks = [
    { name: "basic_alpha_gate", ready: !!env.ALPHA_BASIC_USER && (env.ALPHA_BASIC_PASSWORD?.length ?? 0) >= 16 },
    { name: "public_origin", ready: validUrl(origin, ["https:"], true) },
    { name: "google_oidc", ready: !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET },
    { name: "signed_session", ready: Buffer.byteLength(env.MONSTERA_SESSION_SECRET ?? "", "utf8") >= 32 },
    { name: "nonproduction_neon_url", ready: validDatabaseUrl(env.DATABASE_URL) },
    { name: "upstash_rest", ready: validUrl(env.UPSTASH_REDIS_REST_URL, ["https:"]) && !!env.UPSTASH_REDIS_REST_TOKEN },
    { name: "ai_provider_keys", ready: !!env.OPENROUTER_API_KEY || !!env.DEEPINFRA_API_KEY },
    { name: "free_alpha_opt_in", ready: env.MONSTERA_FREE_CHAT_ENABLED === "true" },
    { name: "approved_model_allowlist", ready: !!env.MONSTERA_ALPHA_APPROVED_MODELS?.trim() },
    { name: "global_request_cap", ready: validRateCap(env.MONSTERA_ALPHA_DAILY_REQUEST_CAP) },
  ];
  return {
    readyForApprovedLiveTesting: checks.every(check => check.ready),
    checks,
    advisory: "Credentials and monetary spend limits remain unverified. No external API calls were made.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = inspectIntegrationConfig();
  for (const check of report.checks) {
    process.stdout.write(check.name + ": " + (check.ready ? "CONFIGURED" : "MISSING_OR_INVALID") + "\n");
  }
  process.stdout.write("syntactic_readiness: " + (report.readyForApprovedLiveTesting ? "PASS" : "BLOCKED") + "\n");
  process.stdout.write("live_provider_spend_budget: NOT_VERIFIED\n");
  if (process.argv.includes("--require-ready") && !report.readyForApprovedLiveTesting) process.exitCode = 1;
}
