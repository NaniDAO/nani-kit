import { z } from "zod";
import { formatUnits } from "viem";
import { decodeBase58 } from "./base58.js";
import { SOLANA_TOKENS, SOL_DECIMALS } from "./constants.js";

// 32-byte public keys encode to at most 44 base58 characters; 64-byte
// signatures encode to at most 88. Check these bounds before decodeBase58,
// whose carry loop grows with every input character.
const MAX_ADDRESS_BASE58_LENGTH = 44;
const MAX_SIGNATURE_BASE58_LENGTH = 88;

const decodedLength = (value: string): number | null => {
  try {
    return decodeBase58(value).length;
  } catch {
    return null;
  }
};

/** A Solana address is a base58-encoded 32-byte ed25519 public key. */
export const solanaAddressSchema = z.string().transform((val, ctx) => {
  const address = val.trim();
  if (
    address.length > MAX_ADDRESS_BASE58_LENGTH ||
    decodedLength(address) !== 32
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid Solana address - expected a base58-encoded 32-byte public key",
    });
    return z.NEVER;
  }
  return address;
});

/** A transaction signature is base58-encoded 64 bytes. */
export const solanaSignatureSchema = z.string().transform((val, ctx) => {
  const signature = val.trim();
  if (
    signature.length > MAX_SIGNATURE_BASE58_LENGTH ||
    decodedLength(signature) !== 64
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid Solana signature - expected a base58-encoded 64-byte signature",
    });
    return z.NEVER;
  }
  return signature;
});

/** Accepts a mint address or one of the symbols in SOLANA_TOKENS. */
export const resolveSolanaMint = (token: string): string => {
  const input = token.trim();
  const known = SOLANA_TOKENS[input.toUpperCase()];
  if (known) return known;

  if (
    input.length > MAX_ADDRESS_BASE58_LENGTH ||
    decodedLength(input) !== 32
  ) {
    throw new Error(
      `Invalid token "${token}" - expected a base58 mint address or one of ${Object.keys(SOLANA_TOKENS).join(", ")}`,
    );
  }
  return input;
};

export const formatLamports = (lamports: bigint | number | string): string =>
  formatUnits(BigInt(lamports), SOL_DECIMALS);
