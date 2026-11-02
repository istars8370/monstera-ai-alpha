import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import nacl from "tweetnacl";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const SIWS_COOKIE = "monstera_siws_nonce";
export const SIWS_COOKIE_OPTIONS = {
  httpOnly: true, sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/api/auth/wallet", maxAge: 300,
};
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const NONCE_TTL_MS = 5 * 60 * 1000;

export interface WalletChallenge {
  nonce: string;
  issuedAt: number;
  domain: string;
}

export function decodeBase58(value: string): Uint8Array {
  if (!value || value.length > 96) throw new Error("INVALID_BASE58");
  let integer = 0n;
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) throw new Error("INVALID_BASE58");
    integer = integer * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (integer > 0n) {
    bytes.unshift(Number(integer % 256n));
    integer /= 256n;
  }
  let zeros = 0;
  while (zeros < value.length && value[zeros] === "1") zeros++;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes]);
}

export function validWalletAddress(value: string): Uint8Array {
  if (value.length < 32 || value.length > 44) throw new Error("INVALID_WALLET_ADDRESS");
  const key = decodeBase58(value);
  if (key.length !== 32) throw new Error("INVALID_WALLET_ADDRESS");
  return key;
}

function signPayload(payload: string, secret: string): string {
  if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("AUTH_NOT_CONFIGURED");
  return createHmac("sha256", secret).update("monstera-siws-v1:" + payload).digest("base64url");
}
export function walletOrigin(): URL {
  const raw = process.env.MONSTERA_PUBLIC_ORIGIN;
  if (!raw) throw new Error("INVALID_WALLET_ORIGIN");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("INVALID_WALLET_ORIGIN"); }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local && url.protocol === "http:")) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("INVALID_WALLET_ORIGIN");
  }
  return url;
}
export function issueWalletChallenge(secret: string, now = Date.now()): { challenge: WalletChallenge; cookie: string } {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("INVALID_NONCE_TIME");
  const challenge = { nonce: randomBytes(32).toString("base64url"), issuedAt: now, domain: walletOrigin().host };
  const payload = Buffer.from(JSON.stringify(challenge)).toString("base64url");
  return { challenge, cookie: payload + "." + signPayload(payload, secret) };
}
export function verifyWalletChallenge(
  cookie: string | undefined, secret: string, now = Date.now(),
): WalletChallenge | null {
  if (!cookie || cookie.length > 1024 || !Number.isSafeInteger(now)) return null;
  const parts = cookie.split(".");
  if (parts.length !== 2) return null;
  let expected: string;
  try { expected = signPayload(parts[0], secret); } catch { return null; }
  const actual = Buffer.from(parts[1], "utf8"), correct = Buffer.from(expected, "utf8");
  if (actual.length !== correct.length || !timingSafeEqual(actual, correct)) return null;
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
  catch { return null; }
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Partial<WalletChallenge>;
  if (typeof value.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.nonce) ||
      !Number.isSafeInteger(value.issuedAt) || typeof value.issuedAt !== "number" ||
      typeof value.domain !== "string" ||
      now < value.issuedAt || now - value.issuedAt > NONCE_TTL_MS ||
      value.domain !== walletOrigin().host) return null;
  return { nonce: value.nonce, issuedAt: value.issuedAt, domain: value.domain };
}
export function walletSigningMessage(challenge: WalletChallenge, address: string): string {
  validWalletAddress(address);
  return [
    "Sign-In With Solana — MONSTERA AI",
    "Domain: " + challenge.domain,
    "Address: " + address,
    "Nonce: " + challenge.nonce,
    "Issued At: " + new Date(challenge.issuedAt).toISOString(),
  ].join("\n");
}
export function verifyWalletSignature(address: string, signature: string, message: string): boolean {
  try {
    const publicKey = validWalletAddress(address);
    const detached = decodeBase58(signature);
    if (detached.length !== 64) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), detached, publicKey);
  } catch { return false; }
}

export const SIWS_ONCE_LUA = [
  "if redis.call('SETNX', KEYS[1], 'used') ~= 1 then return 0 end",
  "redis.call('EXPIRE', KEYS[1], 360)",
  "return 1",
].join("\n");
export async function consumeWalletNonce(
  cookie: string,
  evalScript: (script: string, keys: string[], args: string[]) => Promise<unknown>,
  namespace: string,
): Promise<boolean> {
  if (!/^[a-z][a-z0-9:-]{3,48}$/.test(namespace)) throw new Error("SIWS_REDIS_NOT_CONFIGURED");
  const hash = createHash("sha256").update(cookie).digest("hex");
  const result = await evalScript(SIWS_ONCE_LUA, [namespace + ":siws-consumed:" + hash], []);
  if (result !== 0 && result !== 1) throw new Error("SIWS_REPLAY_GATE_UNAVAILABLE");
  return result === 1;
}

export type WalletTier = "free" | "creator" | "studio";
function threshold(value: string | undefined): bigint | null {
  if (value === undefined || value === "") return null;
  if (!/^[1-9][0-9]*$/.test(value) || value.length > 15) throw new Error("INVALID_TIER_THRESHOLD");
  return BigInt(value);
}
export async function fetchWalletTier(
  address: string, fetcher: typeof fetch = fetch,
): Promise<WalletTier> {
  validWalletAddress(address);
  const rawUrl = process.env.SOLANA_RPC_URL;
  const mint = process.env.MONSTERA_TIER_TOKEN_MINT;
  if (!rawUrl || !mint) throw new Error("SOLANA_RPC_NOT_CONFIGURED");
  validWalletAddress(mint);
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("SOLANA_RPC_NOT_CONFIGURED"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash) {
    throw new Error("SOLANA_RPC_NOT_CONFIGURED");
  }
  const creator = threshold(process.env.MONSTERA_TIER_CREATOR_MIN);
  const studio = threshold(process.env.MONSTERA_TIER_STUDIO_MIN);
  if (creator !== null && studio !== null && studio < creator) throw new Error("INVALID_TIER_THRESHOLD");
  const response = await fetcher(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
      params: [address, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }],
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("SOLANA_RPC_UNAVAILABLE");
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("result" in payload)) throw new Error("INVALID_RPC_RESPONSE");
  const result = (payload as { result: unknown }).result;
  if (!result || typeof result !== "object" || !("value" in result) ||
      !Array.isArray(result.value) || result.value.length > 1000) throw new Error("INVALID_RPC_RESPONSE");
  let decimals: number | null = null;
  let amount = 0n;
  for (const account of result.value as unknown[]) {
    if (!account || typeof account !== "object" || !("account" in account)) throw new Error("INVALID_RPC_RESPONSE");
    const entry = (account as { account: unknown }).account;
    if (!entry || typeof entry !== "object" || !("data" in entry)) throw new Error("INVALID_RPC_RESPONSE");
    const data = (entry as { data: unknown }).data;
    if (!data || typeof data !== "object" || !("parsed" in data)) throw new Error("INVALID_RPC_RESPONSE");
    const parsed = (data as { parsed: unknown }).parsed;
    if (!parsed || typeof parsed !== "object" || !("info" in parsed)) throw new Error("INVALID_RPC_RESPONSE");
    const info = (parsed as { info: unknown }).info;
    if (!info || typeof info !== "object" || !("mint" in info)) throw new Error("INVALID_RPC_RESPONSE");
    if (info.mint !== mint) continue;
    if (!("tokenAmount" in info)) throw new Error("INVALID_RPC_RESPONSE");
    const token = info.tokenAmount as { amount?: unknown; decimals?: unknown };
    if (!token || typeof token.amount !== "string" || !/^[0-9]+$/.test(token.amount) ||
        token.amount.length > 60 || typeof token.decimals !== "number" ||
        !Number.isSafeInteger(token.decimals) || token.decimals < 0 || token.decimals > 18 ||
        (decimals !== null && decimals !== token.decimals)) throw new Error("INVALID_RPC_RESPONSE");
    decimals = token.decimals;
    amount += BigInt(token.amount);
    if (amount > (1n << 128n)) throw new Error("INVALID_RPC_RESPONSE");
  }
  if (decimals === null) return "free";
  const unit = 10n ** BigInt(decimals);
  if (studio !== null && amount >= studio * unit) return "studio";
  if (creator !== null && amount >= creator * unit) return "creator";
  return "free";
}
