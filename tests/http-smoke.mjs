import test from "node:test";
import assert from "node:assert/strict";

const base = process.env.MONSTERA_TEST_HTTP_ORIGIN ?? "http://127.0.0.1:3307";
const credentials = "Basic " + Buffer.from("ci-alpha:ci-only-alpha-password-not-a-real-secret").toString("base64");
const local = new URL(base).origin;
const headers = { authorization: credentials };

test("HTTP: unauthenticated homepage is private; health is public", async () => {
  const page = await fetch(base + "/", { redirect: "manual" });
  assert.equal(page.status, 401);
  assert.equal(page.headers.get("cache-control"), "no-store");
  const health = await fetch(base + "/api/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");
  const authorized = await fetch(base + "/", { headers });
  assert.equal(authorized.status, 200);
});

test("HTTP: user-scoped APIs reject Basic-authenticated callers without an app session", async () => {
  for (const endpoint of ["/api/models", "/api/credits"]) {
    const response = await fetch(base + endpoint, { headers });
    assert.equal(response.status, 401, endpoint);
    assert.equal((await response.json()).code, "UNAUTHORIZED");
  }
  const response = await fetch(base + "/api/chat", {
    method: "POST", headers: { ...headers, "content-type": "application/json", origin: local },
    body: JSON.stringify({ modelId: "11111111-1111-4111-8111-111111111111", messages: [{ role: "user", content: "hello" }] }),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "UNAUTHORIZED");
});

test("HTTP: alpha-protected Google OAuth initiation has signed state and PKCE", async () => {
  assert.equal((await fetch(base + "/api/auth/google", { redirect: "manual" })).status, 401);
  const response = await fetch(base + "/api/auth/google", { redirect: "manual", headers });
  assert.equal(response.status, 307);
  const target = new URL(response.headers.get("location"));
  assert.equal(target.hostname, "accounts.google.com");
  assert.equal(target.searchParams.get("code_challenge_method"), "S256");
  assert.equal(target.searchParams.get("response_type"), "code");
  assert.equal(target.searchParams.get("redirect_uri"), base + "/api/auth/google/callback");
  assert.equal(target.searchParams.get("state")?.split(".").length, 2);
  const cookie = response.headers.get("set-cookie") ?? "";
  for (const name of ["monstera_oauth_state", "monstera_oauth_nonce", "monstera_oauth_verifier"]) {
    assert.ok(cookie.includes(name), name);
  }
});

test("HTTP: callback rejects forged OAuth state even without the Basic gate", async () => {
  const fake = "R".repeat(43);
  const cookies = [
    "monstera_oauth_state=" + fake,
    "monstera_oauth_nonce=" + fake,
    "monstera_oauth_verifier=" + fake,
  ].join("; ");
  const response = await fetch(
    base + "/api/auth/google/callback?state=" + fake + "&code=forged",
    { redirect: "manual", headers: { cookie: cookies } },
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "SIGN_IN_FAILED");
});

test("HTTP: same-origin protection applies to mutation endpoints", async () => {
  const bad = await fetch(base + "/api/chat", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ messages: [] }),
  });
  assert.equal(bad.status, 403);
  const logout = await fetch(base + "/api/auth/logout", { method: "POST", headers });
  assert.equal(logout.status, 403);
});
