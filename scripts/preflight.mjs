// Offline syntactic readiness inspection only. Never contacts Google/Neon/Upstash/AI,
// prints secrets, proves nonproduction ownership, or authorizes upstream spending.
import { pathToFileURL } from "node:url";

function validUrl(value, protocols, allowLocal = false) {
  try {
    const parsed = new URL(value);
    const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
    return (protocols.includes(parsed.protocol) || (allowLocal && local && parsed.protocol === "http:")) &&
      Boolean(parsed.hostname) && parsed.pathname === "/" && !parsed.hash &&
      !parsed.username && !parsed.password;
  } catch { return false; }
}
function validDatabaseUrl(value, expectedDb) {
  try {
    const parsed = new URL(value);
    return typeof expectedDb === "string" && /^[a-zA-Z0-9_-]{2,80}$/.test(expectedDb) &&
      ["postgres:", "postgresql:"].includes(parsed.protocol) &&
      !!parsed.username && !!parsed.password && !!parsed.hostname &&
      parsed.pathname === "/" + expectedDb &&
      ["require", "verify-ca", "verify-full"].includes(parsed.searchParams.get("sslmode")) &&
      !["localhost", "127.0.0.1"].includes(parsed.hostname) && !parsed.hash;
  } catch { return false; }
}
function boundedDecimal(value, max) {
  return typeof value === "string" && /^[1-9]\d*$/.test(value) &&
    Number.isSafeInteger(Number(value)) && Number(value) <= max;
}
function validNamespace(value) {
  return typeof value === "string" && /^[a-z][a-z0-9:-]{3,48}$/.test(value);
}
function approvedSnapshotConfigured(raw, approvedModelIds, now = Date.now()) {
  if (!raw || raw.length > 16000 || !approvedModelIds) return false;
  let snapshots;
  try { snapshots = JSON.parse(raw); } catch { return false; }
  if (!Array.isArray(snapshots) || snapshots.length < 1 || snapshots.length > 100) return false;
  const keys = snapshots.map(x => x?.provider + ":" + x?.model);
  if (new Set(keys).size !== keys.length) return false;
  for (const entry of snapshots) {
    const priceIn = entry?.inputMicroUsdPerMillion, priceOut = entry?.outputMicroUsdPerMillion;
    const input = entry?.inputTokenCeiling, output = entry?.outputTokenCeiling;
    const review = Date.parse(entry?.reviewedAt);
    if (!["openrouter", "deepinfra"].includes(entry?.provider) ||
        typeof entry.model !== "string" || !entry.model || entry.model.length > 512 ||
        !Number.isSafeInteger(priceIn) || priceIn < 0 || priceIn > 1_000_000_000_000 ||
        !Number.isSafeInteger(priceOut) || priceOut < 0 || priceOut > 1_000_000_000_000 ||
        !Number.isSafeInteger(input) || input < 25000 || input > 1_000_000 ||
        !Number.isSafeInteger(output) || output < 1024 || output > 1_000_000 ||
        !Number.isFinite(review) || review > now || now - review > 7 * 86400000) {
      return false;
    }
  }
  const requested = approvedModelIds.split(",").map(x => x.trim()).filter(Boolean);
  return requested.length > 0 && requested.every(key => keys.includes(key));
}
export function inspectIntegrationConfig(env = process.env) {
  const checks = [
    { name: "basic_alpha_gate", ready: !!env.ALPHA_BASIC_USER && (env.ALPHA_BASIC_PASSWORD?.length ?? 0) >= 16 },
    { name: "public_origin", ready: validUrl(env.MONSTERA_PUBLIC_ORIGIN, ["https:"], true) },
    { name: "google_oidc", ready: !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET },
    { name: "signed_session", ready: Buffer.byteLength(env.MONSTERA_SESSION_SECRET ?? "", "utf8") >= 32 },
    { name: "staging_marker", ready: env.MONSTERA_STAGING_ONLY === "true" },
    { name: "declared_nonproduction_db", ready: validDatabaseUrl(env.DATABASE_URL, env.MONSTERA_EXPECTED_TEST_DB_NAME) },
    { name: "upstash_rest", ready: validUrl(env.UPSTASH_REDIS_REST_URL, ["https:"]) && !!env.UPSTASH_REDIS_REST_TOKEN },
    { name: "redis_namespace", ready: validNamespace(env.MONSTERA_REDIS_NAMESPACE) },
    { name: "ai_provider_keys", ready: !!env.OPENROUTER_API_KEY || !!env.DEEPINFRA_API_KEY },
    { name: "free_alpha_opt_in", ready: env.MONSTERA_FREE_CHAT_ENABLED === "true" },
    { name: "approved_model_allowlist", ready: !!env.MONSTERA_ALPHA_APPROVED_MODELS?.trim() },
    { name: "global_request_cap", ready: boundedDecimal(env.MONSTERA_ALPHA_DAILY_REQUEST_CAP, 1000) },
    { name: "reviewed_upstream_prices", ready: approvedSnapshotConfigured(
      env.MONSTERA_ALPHA_PROVIDER_PRICES_JSON, env.MONSTERA_ALPHA_APPROVED_MODELS,
    ) },
    { name: "estimated_daily_usd_micro_budget", ready: boundedDecimal(
      env.MONSTERA_ALPHA_ESTIMATED_MICRO_USD_PER_DAY, 1_000_000_000,
    ) },
    // This is merely an operator acknowledgment. This tool cannot inspect
    // the actual provider account settings or guarantee a monetary hard cap.
    { name: "provider_spend_limit_acknowledged", ready: env.MONSTERA_PROVIDER_SPENDING_LIMIT_CONFIRMED === "true" },
  ];
  return {
    syntacticallyConfiguredForStagingReview: checks.every(check => check.ready),
    checks,
    advisory: "Syntactic checks only. Actual credentials, nonproduction DB ownership, provider hard spending limits and monetary charges are unverified. No external calls made.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = inspectIntegrationConfig();
  for (const check of report.checks) {
    process.stdout.write(check.name + ": " + (check.ready ? "CONFIGURED" : "MISSING_OR_INVALID") + "\n");
  }
  process.stdout.write("syntactic_readiness: " + (report.syntacticallyConfiguredForStagingReview ? "CONFIGURED" : "BLOCKED") + "\n");
  process.stdout.write("provider_hard_cost_limit: NOT_INDEPENDENTLY_VERIFIED\n");
  if (process.argv.includes("--require-ready") && !report.syntacticallyConfiguredForStagingReview) process.exitCode = 1;
}
