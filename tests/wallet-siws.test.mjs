import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { NextRequest } from "next/server.js";
import { GET as nonce, SIWS_COOKIE } from "../app/api/auth/wallet/nonce/route.ts";
import { POST as verify } from "../app/api/auth/wallet/verify/route.ts";
import { issueWalletChallenge, walletSigningMessage } from "../lib/solana-wallet.ts";
import { createSessionToken } from "../lib/session-token.ts";
import { resetTestDb, addUser, findUserByGoogleSub } from "./mocks/db-pool.mjs";
import { resetTestRedis } from "./mocks/upstash.mjs";

const alpha = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const beta = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const origin = "http://localhost:3000";
const secret = "mock-siws-signing-secret-longer-than-32-bytes";
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes) {
  let value = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let encoded = "";
  while (value > 0n) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; encoded = "1" + encoded; }
  return encoded;
}
function signedRequest(keys, challengeCookie, challenge, userId = alpha) {
  const address = encodeBase58(keys.publicKey);
  const message = walletSigningMessage(challenge, address);
  const signature = encodeBase58(nacl.sign.detached(new TextEncoder().encode(message), keys.secretKey));
  return new NextRequest(origin + "/api/auth/wallet/verify", {
    method: "POST", headers: {
      origin, "content-type": "application/json",
      cookie: SIWS_COOKIE + "=" + challengeCookie + (userId
        ? "; monstera_session=" + createSessionToken(userId, 1, secret) : ""),
    },
    body: JSON.stringify({ walletAddress: address, signature }),
  });
}
async function freshChallenge() {
  const response = nonce();
  assert.equal(response.status, 200);
  const data = await response.json();
  const cookie = response.cookies.get(SIWS_COOKIE)?.value;
  assert.ok(cookie);
  return {
    cookie, challenge: {
      nonce: data.nonce, issuedAt: Date.parse(data.issuedAt), domain: data.domain,
    },
  };
}
beforeEach(() => {
  resetTestDb(); resetTestRedis();
  process.env.MONSTERA_SESSION_SECRET = secret;
  process.env.MONSTERA_PUBLIC_ORIGIN = origin;
  process.env.UPSTASH_REDIS_REST_URL = "https://offline-wallet.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "mock-do-not-use-real";
  process.env.MONSTERA_REDIS_NAMESPACE = "monstera:wallet-test";
  addUser({ id: alpha, email: "a@example.invalid", google_sub: "google-alpha",
    email_verified_at: new Date(), session_epoch: 1, tier: "free" });
  addUser({ id: beta, email: "b@example.invalid", google_sub: "google-beta",
    email_verified_at: new Date(), session_epoch: 1, tier: "free" });
});

test("SIWS: valid ed25519 signature links wallet and reissues signed session", async () => {
  const keys = nacl.sign.keyPair();
  const issued = await freshChallenge();
  const response = await verify(signedRequest(keys, issued.cookie, issued.challenge));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).userId, alpha);
  assert.ok(response.cookies.get("monstera_session")?.value);
  const stored = findUserByGoogleSub("google-alpha");
  assert.equal(stored.wallet_address, encodeBase58(keys.publicKey));
  assert.ok(stored.wallet_verified_at instanceof Date);
});

test("SIWS: a consumed nonce cannot be replayed with a copied cookie", async () => {
  const keys = nacl.sign.keyPair();
  const issued = await freshChallenge();
  assert.equal((await verify(signedRequest(keys, issued.cookie, issued.challenge))).status, 200);
  const replay = await verify(signedRequest(keys, issued.cookie, issued.challenge));
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).code, "INVALID_NONCE");
});

test("SIWS: nonce older than five minutes cannot authenticate", async () => {
  const keys = nacl.sign.keyPair();
  const old = issueWalletChallenge(secret, Date.now() - 301000);
  const response = await verify(signedRequest(keys, old.cookie, old.challenge));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "INVALID_NONCE");
});

test("SIWS: forged ed25519 signature is rejected without linking", async () => {
  const real = nacl.sign.keyPair();
  const attacker = nacl.sign.keyPair();
  const issued = await freshChallenge();
  const genuineAddress = encodeBase58(real.publicKey);
  const message = walletSigningMessage(issued.challenge, genuineAddress);
  const forged = encodeBase58(nacl.sign.detached(new TextEncoder().encode(message), attacker.secretKey));
  const response = await verify(new NextRequest(origin + "/api/auth/wallet/verify", {
    method: "POST",
    headers: {
      origin, "content-type": "application/json",
      cookie: SIWS_COOKIE + "=" + issued.cookie +
        "; monstera_session=" + createSessionToken(alpha, 1, secret),
    },
    body: JSON.stringify({ walletAddress: genuineAddress, signature: forged }),
  }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "INVALID_SIGNATURE");
  assert.equal(findUserByGoogleSub("google-alpha").wallet_address, undefined);
});

test("SIWS: an existing wallet bound to another account returns 409, no auto merge", async () => {
  const keys = nacl.sign.keyPair();
  const wallet = encodeBase58(keys.publicKey);
  findUserByGoogleSub("google-beta").wallet_address = wallet;
  const issued = await freshChallenge();
  const response = await verify(signedRequest(keys, issued.cookie, issued.challenge));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "WALLET_ALREADY_LINKED");
  assert.equal(findUserByGoogleSub("google-alpha").wallet_address, undefined);
});

test("SIWS: wallet-only login is allowed after prior Google-account binding", async () => {
  const keys = nacl.sign.keyPair();
  const wallet = encodeBase58(keys.publicKey);
  findUserByGoogleSub("google-alpha").wallet_address = wallet;
  const issued = await freshChallenge();
  const response = await verify(signedRequest(keys, issued.cookie, issued.challenge, null));
  assert.equal(response.status, 200);
  assert.ok(response.cookies.get("monstera_session")?.value);
  assert.equal((await response.json()).userId, alpha);
});
