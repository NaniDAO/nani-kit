/**
 * Test helpers for Agentek tools
 *
 * These helpers use REAL APIs and chains - no mocking.
 * Tests may fail if APIs are down or rate limited - that's intentional.
 */

import { createPublicClient, type Address, type Hex, isAddress, isHex } from "viem";
import { mainnet, base, arbitrum, optimism, polygon } from "viem/chains";
import { resolveTransports } from "./chains/config.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createAgentekClient, type AgentekClient, type BaseTool, type Intent, type Op, isTransactionOp } from "./client.js";

// Common chains for testing
export const TEST_CHAINS = [mainnet, base, arbitrum, optimism, polygon];

// Well-known addresses that definitely exist and have activity
export const TEST_ADDRESSES = {
  // Vitalik's address - always has ETH and tokens
  vitalik: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as Address,
  // USDC contract on various chains
  usdc: {
    mainnet: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
    base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
    arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address,
  },
  // DAI
  dai: {
    mainnet: "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address,
  },
  // WETH
  weth: {
    mainnet: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
    base: "0x4200000000000000000000000000000000000006" as Address,
    arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" as Address,
  },
  // Uniswap Router
  uniswapRouter: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" as Address,
  // ENS registry
  ensRegistry: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as Address,
  // Zero address
  zero: "0x0000000000000000000000000000000000000000" as Address,
  // A known NFT (Bored Ape #1)
  bayc: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" as Address,
  // Aave V3 Pool
  aavePool: {
    mainnet: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as Address,
    base: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" as Address,
  },
} as const;

// Well-known ENS names
export const TEST_ENS = {
  vitalik: "vitalik.eth",
  nick: "nick.eth",
  brantly: "brantly.eth",
} as const;

/**
 * Creates a test client with real transports
 * Uses a random private key (no real funds needed for read operations)
 */
export function createTestClient(tools: BaseTool[], chains = TEST_CHAINS): AgentekClient {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  return createAgentekClient({
    transports: resolveTransports(chains),
    chains,
    accountOrAddress: account,
    tools,
  });
}

/**
 * Creates a read-only test client (address only, no account)
 */
export function createReadOnlyTestClient(tools: BaseTool[], chains = TEST_CHAINS): AgentekClient {
  return createAgentekClient({
    transports: resolveTransports(chains),
    chains,
    accountOrAddress: TEST_ADDRESSES.vitalik, // Use vitalik's address for read-only
    tools,
  });
}

/**
 * Get a standalone public client for direct chain queries
 */
export function getPublicClient(chainId: number) {
  const chain = TEST_CHAINS.find(c => c.id === chainId);
  if (!chain) throw new Error(`Chain ${chainId} not in test chains`);

  return createPublicClient({
    chain,
    transport: resolveTransports([chain])[0],
  });
}

/**
 * Validates that an Intent has the correct structure
 */
export function validateIntent(intent: Intent): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!intent.intent || typeof intent.intent !== "string") {
    errors.push("Intent must have a string 'intent' field describing the action");
  }

  if (!Array.isArray(intent.ops)) {
    errors.push("Intent must have an 'ops' array");
  } else {
    intent.ops.forEach((op, i) => {
      if (isTransactionOp(op)) {
        if (!isAddress(op.target)) {
          errors.push(`Op[${i}].target is not a valid address: ${op.target}`);
        }
        if (typeof op.value !== "string") {
          errors.push(`Op[${i}].value must be a string (wei amount): ${op.value}`);
        }
        if (!isHex(op.data)) {
          errors.push(`Op[${i}].data is not valid hex: ${op.data}`);
        }
      }
    });
  }

  if (typeof intent.chain !== "number") {
    errors.push("Intent must have a numeric 'chain' field");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates an Op structure
 */
export function validateOp(op: Op): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isAddress(op.target)) {
    errors.push(`Invalid target address: ${op.target}`);
  }

  if (typeof op.value !== "string") {
    errors.push(`Value must be string (wei): ${op.value}`);
  } else {
    try {
      BigInt(op.value); // Should be parseable as BigInt
    } catch {
      errors.push(`Value not parseable as BigInt: ${op.value}`);
    }
  }

  if (!isHex(op.data)) {
    errors.push(`Data must be hex: ${op.data}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if an environment variable is set (for API key tests)
 */
export function hasEnvVar(name: string): boolean {
  return !!process.env[name];
}

/**
 * Skip message for tests requiring API keys
 */
export function skipIfNoApiKey(keyName: string): string {
  return `Skipping: ${keyName} environment variable not set`;
}

/**
 * Retry helper for flaky API calls
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }

  throw lastError;
}

/**
 * Test that a tool has required structure
 */
export function validateToolStructure(tool: BaseTool): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!tool.name || typeof tool.name !== "string") {
    errors.push("Tool must have a string 'name'");
  }

  if (!tool.description || typeof tool.description !== "string") {
    errors.push("Tool must have a string 'description'");
  }

  if (!tool.parameters || typeof tool.parameters.parse !== "function") {
    errors.push("Tool must have a Zod 'parameters' schema");
  }

  if (typeof tool.execute !== "function") {
    errors.push("Tool must have an 'execute' function");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Common token amounts for testing
 */
export const TEST_AMOUNTS = {
  oneEth: "1000000000000000000", // 1 ETH in wei
  oneUsdc: "1000000", // 1 USDC (6 decimals)
  oneDai: "1000000000000000000", // 1 DAI (18 decimals)
} as const;
