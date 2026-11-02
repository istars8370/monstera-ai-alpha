// libsodium-wrappers-sumo 0.7.x에는 TypeScript 선언이 제공되지 않는다.
// 실제로 사용하는 XChaCha20-Poly1305와 Argon2id API만 좁게 선언한다.
declare module "libsodium-wrappers-sumo" {
  interface SodiumSumo {
    readonly ready: Promise<void>;
    readonly crypto_pwhash_ALG_ARGON2ID13: number;
    randombytes_buf(length: number): Uint8Array;
    crypto_pwhash(
      outputLength: number,
      password: string,
      salt: Uint8Array,
      operations: number,
      memoryBytes: number,
      algorithm: number,
    ): Uint8Array;
    crypto_aead_xchacha20poly1305_ietf_encrypt(
      message: Uint8Array,
      additionalData: Uint8Array | null,
      secretNonce: null,
      nonce: Uint8Array,
      key: Uint8Array,
    ): Uint8Array;
    crypto_aead_xchacha20poly1305_ietf_decrypt(
      secretNonce: null,
      ciphertext: Uint8Array,
      additionalData: Uint8Array | null,
      nonce: Uint8Array,
      key: Uint8Array,
    ): Uint8Array;
  }
  const sodium: SodiumSumo;
  export default sodium;
}
