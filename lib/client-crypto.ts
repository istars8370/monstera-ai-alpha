import sodium from "libsodium-wrappers-sumo";

// XChaCha20-Poly1305 본문 암호화와 Argon2id 키 유도는 브라우저에서만 수행한다.
// 서버에는 패스프레이즈, 키, 평문 및 salt를 보내지 않는다.
export interface EncryptedRecord {
  v: 2;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}
export const DEVICE_SALT_BYTES = 16;
export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const ARGON2_OPS = 3;
export const ARGON2_MEMORY = 64 * 1024 * 1024;

async function ready() {
  await sodium.ready;
  return sodium;
}
function validScope(userId: string, kind: string): void {
  if (typeof userId !== "string" || !userId || userId.length > 128 ||
      typeof kind !== "string" || !/^[a-z][a-z0-9:-]{0,63}$/.test(kind)) {
    throw new Error("INVALID_ENCRYPTION_SCOPE");
  }
}
function aad(userId: string, kind: string): Uint8Array {
  validScope(userId, kind);
  return new TextEncoder().encode(JSON.stringify(["MONSTERA_LOCAL_V2", kind, userId]));
}
function requireKey(key: Uint8Array | null): Uint8Array {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
    throw new Error("LOCAL_STORAGE_LOCKED");
  }
  return key;
}
export async function generateDeviceSalt(): Promise<Uint8Array> {
  const sodiumReady = await ready();
  return sodiumReady.randombytes_buf(DEVICE_SALT_BYTES);
}
export async function deriveDeviceKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  if (typeof passphrase !== "string" || passphrase.length < 8 ||
      passphrase.length > 1024 || !(salt instanceof Uint8Array) ||
      salt.length !== DEVICE_SALT_BYTES) throw new Error("INVALID_PASSPHRASE");
  const sodiumReady = await ready();
  if (typeof sodiumReady.crypto_pwhash !== "function") {
    throw new Error("ARGON2ID_UNAVAILABLE");
  }
  try {
    return sodiumReady.crypto_pwhash(
      KEY_BYTES, passphrase, salt, ARGON2_OPS, ARGON2_MEMORY,
      sodiumReady.crypto_pwhash_ALG_ARGON2ID13,
    );
  } catch {
    throw new Error("KEY_DERIVATION_FAILED");
  }
}
export function eraseDeviceKey(key: Uint8Array | null): void {
  if (key) key.fill(0);
}
export function isEncryptedRecord(value: unknown): value is EncryptedRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.v === 2 && record.nonce instanceof Uint8Array &&
    record.nonce.length === NONCE_BYTES && record.ciphertext instanceof Uint8Array &&
    record.ciphertext.length >= 16 && record.ciphertext.length <= 1024 * 1024;
}
export async function encryptRecord(
  userId: string, kind: string, value: unknown, key: Uint8Array | null,
): Promise<EncryptedRecord> {
  const locked = requireKey(key);
  const sodiumReady = await ready();
  const message = new TextEncoder().encode(JSON.stringify(value));
  if (message.length > 1024 * 1024 - 16) throw new Error("LOCAL_RECORD_TOO_LARGE");
  const nonce = sodiumReady.randombytes_buf(NONCE_BYTES);
  const ciphertext = sodiumReady.crypto_aead_xchacha20poly1305_ietf_encrypt(
    message, aad(userId, kind), null, nonce, locked,
  );
  return { v: 2, nonce, ciphertext };
}
export async function decryptRecord(
  userId: string, kind: string, record: unknown, key: Uint8Array | null,
): Promise<unknown> {
  const locked = requireKey(key);
  if (!isEncryptedRecord(record)) throw new Error("INVALID_ENCRYPTED_RECORD");
  const sodiumReady = await ready();
  let plaintext: Uint8Array;
  try {
    plaintext = sodiumReady.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null, record.ciphertext, aad(userId, kind), record.nonce, locked,
    );
  } catch { throw new Error("DECRYPTION_FAILED"); }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as unknown;
  } catch {
    throw new Error("INVALID_DECRYPTED_DATA");
  } finally {
    plaintext.fill(0);
  }
}
