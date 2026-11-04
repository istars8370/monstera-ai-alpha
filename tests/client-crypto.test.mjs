import test from "node:test";
import assert from "node:assert/strict";
import {
  generateDeviceSalt, deriveDeviceKey, encryptRecord, decryptRecord,
  eraseDeviceKey, isEncryptedRecord,
} from "../lib/client-crypto.ts";

test("crypto: XChaCha20-Poly1305 encrypt/decrypt round trip with real sodium and Argon2id", async () => {
  const salt = await generateDeviceSalt();
  assert.equal(salt.length, 16);
  const key = await deriveDeviceKey("sample-passphrase-12345", salt);
  assert.equal(key.length, 32);
  const messages = [{ role: "user", content: "비밀 토큰이 아닌 사용자 대화" }];
  const encrypted = await encryptRecord("user-a", "messages", messages, key);
  assert.equal(encrypted.v, 2);
  assert.equal(encrypted.nonce.length, 24);
  assert.equal(isEncryptedRecord(encrypted), true);
  assert.ok(encrypted.ciphertext.length >= 16);
  assert.equal(Buffer.from(encrypted.ciphertext).includes(Buffer.from(messages[0].content)), false);
  assert.deepEqual(await decryptRecord("user-a", "messages", encrypted, key), messages);
  eraseDeviceKey(key);
});

test("crypto: tampered ciphertext is never returned as plaintext", async () => {
  const key = await deriveDeviceKey("some-other-passphrase", await generateDeviceSalt());
  const encrypted = await encryptRecord("account-a", "messages", [{ content: "secret" }], key);
  encrypted.ciphertext[0] ^= 1;
  await assert.rejects(decryptRecord("account-a", "messages", encrypted, key), /DECRYPTION_FAILED/);
  eraseDeviceKey(key);
});

test("crypto: AAD denies cross-user replacement even with same passphrase key", async () => {
  const key = await deriveDeviceKey("another-correct-passphrase", await generateDeviceSalt());
  const encrypted = await encryptRecord("account-a", "messages", [{ content: "account A" }], key);
  await assert.rejects(decryptRecord("account-b", "messages", encrypted, key), /DECRYPTION_FAILED/);
  await assert.rejects(decryptRecord("account-a", "metadata", encrypted, key), /DECRYPTION_FAILED/);
  eraseDeviceKey(key);
});

test("crypto: a wiped key cannot unlock previously encrypted records", async () => {
  const key = await deriveDeviceKey("safe-memonly-password", await generateDeviceSalt());
  const record = await encryptRecord("account-a", "messages", [{ role: "user", content: "secret" }], key);
  eraseDeviceKey(key);
  assert.ok(key.every(byte => byte === 0));
  await assert.rejects(decryptRecord("account-a", "messages", record, null), /LOCAL_STORAGE_LOCKED/);
  await assert.rejects(decryptRecord("account-a", "messages", record, key), /DECRYPTION_FAILED/);
});
