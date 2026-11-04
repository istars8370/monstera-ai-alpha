import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { NextRequest } from "next/server.js";
import { GET as startOAuth } from "../app/api/auth/google/route.ts";
import { GET as finishOAuth } from "../app/api/auth/google/callback/route.ts";
import { POST as logout } from "../app/api/auth/logout/route.ts";
import { GET as models } from "../app/api/models/route.ts";
import { GET as balance } from "../app/api/credits/route.ts";
import { addUser, addCredits, resetTestDb, findUserByGoogleSub } from "./mocks/db-pool.mjs";

const origin = "http://localhost:3000";
const secret = "mock-only-session-key-longer-than-thirty-two-bytes";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "mock-google-key", use: "sig", alg: "RS256" };
let externalCalls;

beforeEach(() => {
  resetTestDb();
  externalCalls = [];
  process.env.GOOGLE_CLIENT_ID = "mock-client";
  process.env.GOOGLE_CLIENT_SECRET = "mock-secret-not-real";
  process.env.MONSTERA_PUBLIC_ORIGIN = origin;
  process.env.MONSTERA_SESSION_SECRET = secret;
});

function idToken(email, subject, nonce) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "https://accounts.google.com", aud: "mock-client", nonce, exp: now + 300,
    iat: now, sub: subject, email, email_verified: true,
  })).toString("base64url");
  const data = header + "." + payload;
  return data + "." + sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url");
}
function stubGoogle(email, subject, nonce) {
  globalThis.fetch = async (url, options) => {
    externalCalls.push(String(url));
    if (url === "https://oauth2.googleapis.com/token") {
      const values = new URLSearchParams(options.body);
      assert.equal(values.get("client_id"), "mock-client");
      assert.equal(values.get("client_secret"), "mock-secret-not-real");
      assert.ok(values.get("code_verifier"));
      return Response.json({ id_token: idToken(email, subject, nonce) });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return Response.json({ keys: [jwk] });
    }
    throw new Error("REAL_EXTERNAL_NETWORK_CALL_FORBIDDEN");
  };
}
async function login(email, subject) {
  const beginning = startOAuth();
  assert.equal(beginning.status, 307);
  const location = new URL(beginning.headers.get("location"));
  const state = location.searchParams.get("state");
  const nonce = beginning.cookies.get("monstera_oauth_nonce")?.value;
  assert.ok(nonce);
  const cookies = ["monstera_oauth_state", "monstera_oauth_nonce", "monstera_oauth_verifier"]
    .map(name => name + "=" + beginning.cookies.get(name)?.value).join("; ");
  stubGoogle(email, subject, nonce);
  const response = await finishOAuth(new NextRequest(origin +
    "/api/auth/google/callback?code=isolated-mock-code&state=" + encodeURIComponent(state),
    { headers: { cookie: cookies } }));
  return response;
}

test("mock OAuth E2E: signed initiation, verified Google subject, credits and session", async () => {
  const result = await login("USER@example.invalid", "google-subject-A");
  assert.equal(result.status, 307);
  const user = findUserByGoogleSub("google-subject-A");
  assert.ok(user);
  assert.equal(user.email, "user@example.invalid");
  assert.equal(user.tier, "free");
  assert.equal(externalCalls.length, 2);
  const signed = result.cookies.get("monstera_session")?.value;
  assert.ok(signed);
  const modelResponse = await models(new NextRequest(origin + "/api/models", {
    headers: { cookie: "monstera_session=" + signed },
  }));
  assert.equal(modelResponse.status, 200);
  assert.equal((await modelResponse.json()).userId, user.id);
  const creditsResponse = await balance(new NextRequest(origin + "/api/credits", {
    headers: { cookie: "monstera_session=" + signed },
  }));
  assert.deepEqual(await creditsResponse.json(), { balance: 0, reserved: 0, available: 0 });
});

test("mock OAuth E2E: subject persists across email change without resetting credits", async () => {
  const first = await login("first@example.invalid", "google-stable-id");
  assert.equal(first.status, 307);
  const original = findUserByGoogleSub("google-stable-id");
  addCredits(original.id, 75);
  const second = await login("renamed@example.invalid", "google-stable-id");
  assert.equal(second.status, 307);
  assert.equal(findUserByGoogleSub("google-stable-id").id, original.id);
  const session = second.cookies.get("monstera_session")?.value;
  const response = await balance(new NextRequest(origin + "/api/credits", {
    headers: { cookie: "monstera_session=" + session },
  }));
  assert.equal((await response.json()).balance, 75);
});

test("mock OAuth E2E: email collision and legacy account cannot be automatically claimed", async () => {
  const original = await login("owned@example.invalid", "google-real-owner");
  assert.equal(original.status, 307);
  const impersonator = await login("owned@example.invalid", "google-other-subject");
  assert.equal(impersonator.status, 409);
  assert.equal((await impersonator.json()).code, "ACCOUNT_LINK_REQUIRED");
  assert.equal(impersonator.cookies.get("monstera_session"), undefined);
  assert.equal(findUserByGoogleSub("google-other-subject"), undefined);
  addUser({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "legacy@example.invalid",
    google_sub: null, tier: "studio", session_epoch: 0, email_verified_at: new Date(),
  });
  const legacy = await login("legacy@example.invalid", "google-legacy-impersonator");
  assert.equal(legacy.status, 409);
  assert.equal(findUserByGoogleSub("google-legacy-impersonator"), undefined);
});

test("mock OAuth E2E: logout revokes old signed cookie in database", async () => {
  const result = await login("logout@example.invalid", "google-logout");
  const cookie = "monstera_session=" + result.cookies.get("monstera_session")?.value;
  const request = new NextRequest(origin + "/api/auth/logout", {
    method: "POST", headers: { cookie, origin },
  });
  const signedOut = await logout(request);
  assert.equal(signedOut.status, 200);
  assert.equal(signedOut.cookies.get("monstera_session")?.value, "");
  const oldSession = await models(new NextRequest(origin + "/api/models", { headers: { cookie } }));
  assert.equal(oldSession.status, 401);
});
