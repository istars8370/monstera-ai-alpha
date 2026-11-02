// 브라우저에서는 공개키와 서명만 base58로 전송한다. 개인키는 저장하거나 전송하지 않는다.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0 || bytes.length > 128) throw new Error("INVALID_BASE58");
  let integer = 0n;
  for (const value of bytes) integer = (integer << 8n) + BigInt(value);
  let encoded = "";
  while (integer > 0n) {
    encoded = ALPHABET[Number(integer % 58n)] + encoded;
    integer /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = "1" + encoded;
  }
  return encoded;
}
