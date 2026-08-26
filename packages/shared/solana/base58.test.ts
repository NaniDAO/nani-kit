import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { decodeBase58, encodeBase58 } from "./base58.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, SOLANA_TOKENS } from "./constants.js";
import { resolveSolanaMint, solanaAddressSchema, solanaSignatureSchema } from "./utils.js";

const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

describe("base58", () => {
  it("round-trips the empty value", () => {
    expect(decodeBase58("")).toEqual(new Uint8Array(0));
    expect(encodeBase58(new Uint8Array(0))).toBe("");
  });

  it("maps leading '1's to leading zero bytes", () => {
    const decoded = decodeBase58(SYSTEM_PROGRAM_ID);
    expect(decoded.length).toBe(32);
    expect([...decoded].every((byte) => byte === 0)).toBe(true);
    expect(encodeBase58(new Uint8Array(32))).toBe(SYSTEM_PROGRAM_ID);
  });

  it("encodes a value that carries across byte boundaries", () => {
    // 255 = 4 * 58 + 23 -> "5Q"
    expect(encodeBase58(Uint8Array.from([0xff]))).toBe("5Q");
    expect(decodeBase58("5Q")).toEqual(Uint8Array.from([0xff]));
  });

  it("agrees with @solana/web3.js on real program ids", () => {
    for (const address of [
      TOKEN_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
      ...Object.values(SOLANA_TOKENS),
    ]) {
      const decoded = decodeBase58(address);
      expect(decoded.length).toBe(32);
      expect(new PublicKey(decoded).toBase58()).toBe(address);
      expect(encodeBase58(decoded)).toBe(address);
    }
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => decodeBase58("0OIl")).toThrow(/Invalid base58 character/);
  });
});

describe("solana schemas", () => {
  it("accepts a 32-byte address and trims it", () => {
    expect(solanaAddressSchema.parse(` ${TOKEN_PROGRAM_ID} `)).toBe(TOKEN_PROGRAM_ID);
  });

  it("rejects an EVM address", () => {
    expect(() =>
      solanaAddressSchema.parse("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"),
    ).toThrow();
  });

  it("rejects a base58 string of the wrong length", () => {
    // A signature is 64 bytes, so it is not a valid address.
    expect(() => solanaAddressSchema.parse(encodeBase58(new Uint8Array(64)))).toThrow();
    expect(() => solanaSignatureSchema.parse(TOKEN_PROGRAM_ID)).toThrow();
  });

  it("accepts a 64-byte signature", () => {
    const signature = encodeBase58(Uint8Array.from({ length: 64 }, (_, i) => i + 1));
    expect(solanaSignatureSchema.parse(signature)).toBe(signature);
  });
});

describe("resolveSolanaMint", () => {
  it("resolves known symbols case-insensitively", () => {
    expect(resolveSolanaMint("usdc")).toBe(SOLANA_TOKENS.USDC);
    expect(resolveSolanaMint("USDC")).toBe(SOLANA_TOKENS.USDC);
  });

  it("passes a mint address through unchanged", () => {
    expect(resolveSolanaMint(SOLANA_TOKENS.BONK)).toBe(SOLANA_TOKENS.BONK);
  });

  it("rejects anything that is neither", () => {
    expect(() => resolveSolanaMint("NOT_A_TOKEN")).toThrow(/Invalid token/);
  });
});
