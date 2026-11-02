import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import { NextRequest } from "next/server.js";
import { POST as grant } from "../app/api/credits/grant/route.ts";
import { authenticatedUser } from "../lib/auth.ts";
import { createSessionToken } from "../lib/session-token.ts";
import { resetTestDb, addUser, addCredits, findUserByGoogleSub, grantDays } from "./mocks/db-pool.mjs";

const origin = "http://localhost:3000";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secret = "mock-wallet-tier-session-secret-longer-than-32-bytes";
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function encodeBase58(bytes) {
  let integer = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let result = "";
  while (integer > 0n) { result = alphabet[Number(integer % 58n)] + result; integer /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = "1" + result; }
  return result;
}
const wallet = encodeBase58(nacl.sign.keyPair().publicKey);
const mint = encodeBase58(nacl.sign.keyPair().publicKey);
function request(path = "/api/credits/grant") {
  return new NextRequest(origin + path, {
    method: "POST", headers: {
      origin, cookie: "monstera_session=" + createSessionToken(id, 1, secret),
    },
  });
}
beforeEach(() => {
  resetTestDb();
  addUser({
    id, email: "mock-user@example.invalid", google_sub: "wallet-google-linked",
    email_verified_at: new Date(), session_epoch: 1, tier: "studio", wallet_address: wallet,
  });
  addCredits(id, 500, 30);
  process.env.MONSTERA_SESSION_SECRET = secret;
  process.env.MONSTERA_PUBLIC_ORIGIN = origin;
  process.env.SOLANA_RPC_URL = "https://offline-rpc.example.invalid";
  process.env.MONSTERA_TIER_TOKEN_MINT = mint;
  process.env.MONSTERA_TIER_CREATOR_MIN = "10";
  process.env.MONSTERA_TIER_STUDIO_MIN = "100";
  process.env.MONSTERA_DAILY_GRANT_FREE = "1";
  process.env.MONSTERA_DAILY_GRANT_CREATOR = "5";
  process.env.MONSTERA_DAILY_GRANT_STUDIO = "10";
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.method, "getTokenAccountsByOwner");
    assert.equal(payload.params[0], wallet);
    return Response.json({
      jsonrpc: "2.0", id: 1,
      result: { value: [{ account: {
        data: { parsed: { info: {
          mint, tokenAmount: { amount: "50000000000", decimals: 9 },
        } } },
      } }] },
    });
  };
});

test("wallet daily grants: two same-day POSTs increase balance exactly once", async () => {
  const first = await grant(request());
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { tier: "creator", granted: 5, alreadyGranted: false });
  const second = await grant(request());
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { tier: "creator", granted: 0, alreadyGranted: true });
  assert.equal(grantDays(id).length, 1);
  assert.equal(findUserByGoogleSub("wallet-google-linked").tier, "creator");
  const nextRequest = await authenticatedUser(request());
  assert.equal(nextRequest?.tier, "creator");
});

test("wallet daily grants: Solana RPC failure forces free and issues zero credits", async () => {
  globalThis.fetch = async () => { throw new Error("MOCK_TIMEOUT"); };
  const first = await grant(request());
  assert.equal(first.status, 503);
  assert.deepEqual(await first.json(), {
    code: "SOLANA_RPC_UNAVAILABLE", tier: "free", granted: 0,
  });
  const user = findUserByGoogleSub("wallet-google-linked");
  assert.equal(user.tier, "free");
  assert.equal(grantDays(id).length, 0);
  const token = await authenticatedUser(request());
  assert.equal(token?.tier, "free");
});

test("wallet daily grants: missing mint or thresholds never elevates tier", async () => {
  delete process.env.MONSTERA_TIER_CREATOR_MIN;
  delete process.env.MONSTERA_TIER_STUDIO_MIN;
  const free = await grant(request());
  assert.equal(free.status, 200);
  assert.equal((await free.json()).tier, "free");
  assert.equal(grantDays(id).length, 1);
});

test("wallet tier: invalid persisted tier is interpreted as free, not elevated", async () => {
  findUserByGoogleSub("wallet-google-linked").tier = "superuser";
  const authenticated = await authenticatedUser(request());
  assert.equal(authenticated?.tier, "free");
});
