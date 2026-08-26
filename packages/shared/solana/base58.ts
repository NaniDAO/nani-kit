// Solana encodes addresses, secret keys and signatures as base58 (Bitcoin
// alphabet). @solana/web3.js keeps its own copy private, so we carry a small
// one here — it lets the read tools validate input without loading the SDK.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_MAP = new Map([...ALPHABET].map((char, i) => [char, i]));

export function decodeBase58(value: string): Uint8Array {
  if (value.length === 0) return new Uint8Array(0);

  const bytes: number[] = [];
  for (const char of value) {
    let carry = ALPHABET_MAP.get(char);
    if (carry === undefined) {
      throw new Error(`Invalid base58 character "${char}"`);
    }
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // A leading "1" encodes a leading zero byte, one for one.
  for (let i = 0; i < value.length && value[i] === "1"; i++) {
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
}

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let encoded = "";
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) encoded += "1";
  for (let i = digits.length - 1; i >= 0; i--) encoded += ALPHABET[digits[i]];
  return encoded;
}
