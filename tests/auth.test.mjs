import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createSessionToken, readSessionToken, SESSION_LIFETIME_SECONDS } from "../lib/session-token.ts";
import { fixedTimeEqual, signOAuthState, verifySignedOAuthState, verifyGoogleIdToken } from "../lib/google-oidc.ts";

const uuid = "12345678-1234-4234-a234-123456789abc";
const secret = "local-only-test-secret-with-more-than-32-chars";
const now = 1_800_000_000;

test("session: correct signature, expiry and account epoch", () => {
  const token = createSessionToken(uuid, 3, secret, now);
  const claims = readSessionToken(token, secret, now + 10);
  assert.equal(claims?.sub, uuid);
  assert.equal(claims?.epoch, 3);
  assert.equal(readSessionToken(token, secret, now + SESSION_LIFETIME_SECONDS + 1), null);
  const [body, signature] = token.split(".");
  const tampered = body + "." + (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  assert.equal(readSessionToken(tampered, secret, now), null);
  assert.equal(readSessionToken(token, secret + "wrong", now), null);
  assert.equal(readSessionToken("not.a.valid.jwt", secret, now), null);
  assert.throws(() => createSessionToken(uuid, 0, "short", now), /SESSION_SECRET_TOO_SHORT/);
});

test("OIDC: fixed time state comparison", () => {
  assert.equal(fixedTimeEqual("good", "good"), true);
  assert.equal(fixedTimeEqual("good", "evil"), false);
  assert.equal(fixedTimeEqual(undefined, "good"), false);
});

test("OIDC: Google RSA signature and user claims required", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };
  const fetcher = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  const header = { alg: "RS256", kid: "test-key", typ: "JWT" };
  const makeToken = (claims, signedKey = privateKey) => {
    const data = Buffer.from(JSON.stringify(header)).toString("base64url") + "." +
      Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = sign("RSA-SHA256", Buffer.from(data), signedKey).toString("base64url");
    return data + "." + signature;
  };
  const claims = {
    iss: "https://accounts.google.com", aud: "test-client", nonce: "the-nonce",
    sub: "google-id", email: "USER@example.com", email_verified: true,
    iat: now - 30, exp: now + 300,
  };
  assert.deepEqual(
    await verifyGoogleIdToken(makeToken(claims), "test-client", "the-nonce", fetcher, now),
    { email: "user@example.com", googleSubject: "google-id" },
  );
  await assert.rejects(verifyGoogleIdToken(makeToken(claims), "wrong-audience", "the-nonce", fetcher, now));
  await assert.rejects(verifyGoogleIdToken(makeToken(claims), "test-client", "wrong-nonce", fetcher, now));
  await assert.rejects(verifyGoogleIdToken(makeToken({ ...claims, email_verified: false }), "test-client", "the-nonce", fetcher, now));
  const { privateKey: otherKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await assert.rejects(verifyGoogleIdToken(makeToken(claims, otherKey), "test-client", "the-nonce", fetcher, now));
});


test("OAuth: callback requires signed state from a Basic-protected initiation", () => {
  const secret = "an-isolated-test-secret-longer-than-thirty-two-characters";
  const state = signOAuthState("R".repeat(43), secret);
  assert.equal(verifySignedOAuthState(state, secret), true);
  assert.equal(verifySignedOAuthState(state, secret + "-changed"), false);
  assert.equal(verifySignedOAuthState(state.replace(/^R/, "X"), secret), false);
  assert.equal(verifySignedOAuthState("R".repeat(43), secret), false);
  assert.equal(verifySignedOAuthState(state, "short"), false);
  assert.throws(() => signOAuthState("short", secret), /INVALID_OAUTH_STATE_SECRET/);
});
