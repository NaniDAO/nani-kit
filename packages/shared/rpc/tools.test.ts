import { describe, it, expect } from "vitest";
import { createPublicClient, http, formatUnits, formatEther } from "viem";
import { base, mainnet } from "viem/chains";
import {
  getBalance,
  getCode,
  getTransactionCount,
  getBlock,
  getBlockNumber,
  getGasPrice,
  estimateGas,
  getFeeHistory,
  getTransaction,
  getTransactionReceipt,
} from "./tools.js";
import { rpcTools } from "./index.js";
import { resolveTransports } from "../chains/config.js";
import {
  createTestClient,
  TEST_ADDRESSES,
  withRetry,
} from "../test-helpers.js";

// Create clients for testing
const tools = rpcTools();
const testClient = createTestClient(tools, [base, mainnet]);

// Standalone public clients for verification
const basePublicClient = createPublicClient({
  chain: base,
  transport: resolveTransports([base])[0],
});

const mainnetPublicClient = createPublicClient({
  chain: mainnet,
  transport: resolveTransports([mainnet])[0],
});

// Well-known transaction hashes for testing (real confirmed transactions)
// Base chain transaction - USDC transfer
const BASE_TX_HASH = "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060";
// Mainnet transaction - first ETH transaction ever
const MAINNET_TX_HASH = "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060";

describe("RPC Tools - Real Chain Calls", () => {
  describe("getBalance", () => {
    it("should get ETH balance for a known address on Base", async () => {
      const result = await withRetry(() =>
        getBalance.execute(testClient, {
          address: TEST_ADDRESSES.vitalik,
          chainId: 8453,
        })
      );

      // Result should be a string representing balance in wei
      expect(typeof result).toBe("string");
      expect(BigInt(result)).toBeGreaterThanOrEqual(0n);
    });

    it("should get ETH balance with formatEth option", async () => {
      const result = await withRetry(() =>
        getBalance.execute(testClient, {
          address: TEST_ADDRESSES.vitalik,
          chainId: 8453,
          formatEth: true,
        })
      );

      // Result should be a formatted string (e.g., "0.123456")
      expect(typeof result).toBe("string");
      expect(parseFloat(result)).toBeGreaterThanOrEqual(0);
    });

    it("should get balance across multiple chains when no chainId specified", async () => {
      const result = await withRetry(() =>
        getBalance.execute(testClient, {
          address: TEST_ADDRESSES.vitalik,
        })
      );

      // Result should be an array of chain balances
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      result.forEach((item: { chainId: number; balance: string }) => {
        expect(item).toHaveProperty("chainId");
        expect(item).toHaveProperty("balance");
        expect(typeof item.balance).toBe("string");
      });
    });

    it("should match direct RPC call result", async () => {
      const directBalance = await withRetry(() =>
        basePublicClient.getBalance({
          address: TEST_ADDRESSES.vitalik,
        })
      );

      const toolResult = await withRetry(() =>
        getBalance.execute(testClient, {
          address: TEST_ADDRESSES.vitalik,
          chainId: 8453,
        })
      );

      expect(toolResult).toBe(directBalance.toString());
    });
  });

  describe("getCode", () => {
    it("should get bytecode for a contract address on Base", async () => {
      const result = await withRetry(() =>
        getCode.execute(testClient, {
          address: TEST_ADDRESSES.usdc.base,
          chainId: 8453,
        })
      );

      // Contract should have bytecode
      expect(typeof result).toBe("string");
      expect(result).toMatch(/^0x/);
      expect(result.length).toBeGreaterThan(2);
    });

    it("should return empty or undefined for EOA address", async () => {
      const result = await withRetry(() =>
        getCode.execute(testClient, {
          address: TEST_ADDRESSES.vitalik,
          chainId: 8453,
        })
      );

      // EOA should have no code
      expect(result === undefined || result === "0x" || result === null).toBe(true);
    });

    it("should get code across multiple chains when no chainId specified", async () => {
      const result = await withRetry(() =>
        getCode.execute(testClient, {
          address: TEST_ADDRESSES.weth.base,
        })
      );

      expect(Array.isArray(result)).toBe(true);
      result.forEach((item: { chainId: number; code: string | undefined }) => {
        expect(item).toHaveProperty("chainId");
        expect(item).toHaveProperty("code");
      });
    });
  });

  describe("getTransactionCount", () => {
    it("should get transaction count for vitalik on mainnet", async () => {
      const result = await withRetry(() =>
        getTransactionCount.execute(testClient, {
          address: TEST_ADDRESSES.vitalik,
          chainId: 1,
        })
      );

      // Vitalik has sent many transactions
      expect(typeof result).toBe("number");
      expect(result).toBeGreaterThan(0);
    });

    it("should get transaction count on Base", async () => {
      const result = await withRetry(() =>
        getTransactionCount.execute(testClient, {
          address: TEST_ADDRESSES.vitalik,
          chainId: 8453,
        })
      );

      expect(typeof result).toBe("number");
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it("should match direct RPC call result", async () => {
      const directCount = await withRetry(() =>
        mainnetPublicClient.getTransactionCount({
          address: TEST_ADDRESSES.vitalik,
        })
      );

      const toolResult = await withRetry(() =>
        getTransactionCount.execute(testClient, {
          address: TEST_ADDRESSES.vitalik,
          chainId: 1,
        })
      );

      expect(toolResult).toBe(directCount);
    });
  });

  describe("getBlock", () => {
    it("should get block info for a specific block number on Base", async () => {
      const result = await withRetry(() =>
        getBlock.execute(testClient, {
          blockNumber: 1000000,
          chainId: 8453,
        })
      );

      expect(result).toHaveProperty("hash");
      expect(result).toHaveProperty("number");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("transactions");
      expect(result.number).toBe("1000000");
    });

    it("should get block info on mainnet", async () => {
      const result = await withRetry(() =>
        getBlock.execute(testClient, {
          blockNumber: 19000000,
          chainId: 1,
        })
      );

      expect(result).toHaveProperty("hash");
      expect(result).toHaveProperty("number");
      expect(result.number).toBe("19000000");
    });

    it("should get latest block when blockNumber is omitted", async () => {
      const result = await withRetry(() =>
        getBlock.execute(testClient, {
          chainId: 8453,
        })
      );

      expect(result).toHaveProperty("hash");
      expect(result).toHaveProperty("number");
      expect(result).toHaveProperty("timestamp");
      expect(BigInt(result.number)).toBeGreaterThan(0n);
    });

    it("should get block 0 (genesis block) correctly", async () => {
      const result = await withRetry(() =>
        getBlock.execute(testClient, {
          blockNumber: 0,
          chainId: 1,
        })
      );

      expect(result).toHaveProperty("hash");
      expect(result).toHaveProperty("number");
      expect(result.number).toBe("0");
    });

    it("should match direct RPC call result", async () => {
      const blockNumber = 1000000;
      const directBlock = await withRetry(() =>
        basePublicClient.getBlock({
          blockNumber: BigInt(blockNumber),
        })
      );

      const toolResult = await withRetry(() =>
        getBlock.execute(testClient, {
          blockNumber,
          chainId: 8453,
        })
      );

      expect(toolResult.hash).toBe(directBlock.hash);
    });
  });

  describe("getBlockNumber", () => {
    it("should get current block number on Base", async () => {
      const result = await withRetry(() =>
        getBlockNumber.execute(testClient, {
          chainId: 8453,
        })
      );

      expect(result).toHaveProperty("chainId");
      expect(result).toHaveProperty("blockNumber");
      expect(result.chainId).toBe(8453);
      expect(BigInt(result.blockNumber)).toBeGreaterThan(0n);
    });

    it("should get current block number on mainnet", async () => {
      const result = await withRetry(() =>
        getBlockNumber.execute(testClient, {
          chainId: 1,
        })
      );

      expect(result).toHaveProperty("chainId");
      expect(result).toHaveProperty("blockNumber");
      expect(result.chainId).toBe(1);
      expect(BigInt(result.blockNumber)).toBeGreaterThan(19000000n);
    });

    it("should get block numbers for all chains when no chainId specified", async () => {
      const result = await withRetry(() =>
        getBlockNumber.execute(testClient, {})
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2); // base and mainnet
      result.forEach((item: { chainId: number; blockNumber: string }) => {
        expect(item).toHaveProperty("chainId");
        expect(item).toHaveProperty("blockNumber");
        expect(BigInt(item.blockNumber)).toBeGreaterThan(0n);
      });
    });

    it("should return a recent block number close to direct RPC call", async () => {
      const directBlockNumber = await withRetry(() =>
        basePublicClient.getBlockNumber()
      );

      const toolResult = await withRetry(() =>
        getBlockNumber.execute(testClient, {
          chainId: 8453,
        })
      );

      // Block numbers should be within 10 blocks of each other (accounting for timing)
      const diff = Math.abs(Number(BigInt(toolResult.blockNumber) - directBlockNumber));
      expect(diff).toBeLessThan(10);
    });
  });

  describe("getGasPrice", () => {
    it("should get gas price on Base", async () => {
      const result = await withRetry(() =>
        getGasPrice.execute(testClient, {
          chainId: 8453,
        })
      );

      expect(result).toHaveProperty("chainId");
      expect(result).toHaveProperty("gasPrice");
      expect(result.chainId).toBe(8453);
      expect(BigInt(result.gasPrice)).toBeGreaterThan(0n);
    });

    it("should get gas price in gwei format", async () => {
      const result = await withRetry(() =>
        getGasPrice.execute(testClient, {
          chainId: 8453,
          formatGwei: true,
        })
      );

      expect(result).toHaveProperty("gasPrice");
      // Should be a decimal string (gwei)
      expect(parseFloat(result.gasPrice)).toBeGreaterThan(0);
    });

    it("should get gas prices for all chains when no chainId specified", async () => {
      const result = await withRetry(() =>
        getGasPrice.execute(testClient, {})
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      result.forEach((item: { chainId: number; gasPrice: string }) => {
        expect(item).toHaveProperty("chainId");
        expect(item).toHaveProperty("gasPrice");
        expect(BigInt(item.gasPrice)).toBeGreaterThan(0n);
      });
    });

    it("should match direct RPC call result", async () => {
      const directGasPrice = await withRetry(() =>
        basePublicClient.getGasPrice()
      );

      const toolResult = await withRetry(() =>
        getGasPrice.execute(testClient, {
          chainId: 8453,
        })
      );

      // Gas prices should be within 50% of each other (can vary quickly)
      const toolPrice = BigInt(toolResult.gasPrice);
      const ratio = Number(toolPrice) / Number(directGasPrice);
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(1.5);
    });
  });

  describe("estimateGas", () => {
    it("should estimate gas for a simple ETH transfer on Base", async () => {
      const result = await withRetry(() =>
        estimateGas.execute(testClient, {
          to: TEST_ADDRESSES.vitalik,
          value: "0.001",
          chainId: 8453,
        })
      );

      expect(result).toHaveProperty("chainId");
      expect(result).toHaveProperty("gas");
      expect(result.chainId).toBe(8453);
      // Simple transfer should be around 21000 gas
      expect(BigInt(result.gas)).toBeGreaterThanOrEqual(21000n);
    });

    it("should estimate gas for contract interaction", async () => {
      // Estimate gas for a simple call to WETH contract
      const result = await withRetry(() =>
        estimateGas.execute(testClient, {
          to: TEST_ADDRESSES.weth.base,
          data: "0x70a08231000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045", // balanceOf(vitalik)
          chainId: 8453,
        })
      );

      expect(result).toHaveProperty("gas");
      // Contract call should use more gas than simple transfer
      expect(BigInt(result.gas)).toBeGreaterThan(21000n);
    });

    it("should estimate gas on mainnet", async () => {
      const result = await withRetry(() =>
        estimateGas.execute(testClient, {
          to: TEST_ADDRESSES.vitalik,
          value: "0.001",
          chainId: 1,
        })
      );

      expect(result).toHaveProperty("chainId");
      expect(result).toHaveProperty("gas");
      expect(result.chainId).toBe(1);
      expect(BigInt(result.gas)).toBeGreaterThanOrEqual(21000n);
    });
  });

  describe("getFeeHistory", () => {
    it("should get fee history on Base", async () => {
      const result = await withRetry(() =>
        getFeeHistory.execute(testClient, {
          blockCount: 5,
          chainId: 8453,
        })
      );

      expect(result).toHaveProperty("baseFeePerGas");
      expect(result).toHaveProperty("gasUsedRatio");
      expect(Array.isArray(result.baseFeePerGas)).toBe(true);
      expect(Array.isArray(result.gasUsedRatio)).toBe(true);
    });

    it("should get fee history with reward percentiles", async () => {
      const result = await withRetry(() =>
        getFeeHistory.execute(testClient, {
          blockCount: 5,
          rewardPercentiles: [25, 50, 75],
          chainId: 8453,
        })
      );

      expect(result).toHaveProperty("baseFeePerGas");
      expect(result).toHaveProperty("gasUsedRatio");
      expect(result).toHaveProperty("reward");
      expect(Array.isArray(result.reward)).toBe(true);
    });

    it("should get fee history on mainnet", async () => {
      const result = await withRetry(() =>
        getFeeHistory.execute(testClient, {
          blockCount: 10,
          chainId: 1,
        })
      );

      expect(result).toHaveProperty("baseFeePerGas");
      expect(Array.isArray(result.baseFeePerGas)).toBe(true);
      expect(result.baseFeePerGas.length).toBeGreaterThan(0);
    });
  });

  describe("getTransaction", () => {
    // Use a well-known mainnet transaction (genesis block coinbase tx won't work, use a real one)
    // First ever Ethereum transaction: 0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060
    const KNOWN_TX_HASH = "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060";

    it("should get transaction details on mainnet", async () => {
      const result = await withRetry(() =>
        getTransaction.execute(testClient, {
          hash: KNOWN_TX_HASH,
          chainId: 1,
        })
      );

      expect(result).toHaveProperty("hash");
      expect(result).toHaveProperty("from");
      expect(result).toHaveProperty("to");
      expect(result).toHaveProperty("value");
      expect(result.hash.toLowerCase()).toBe(KNOWN_TX_HASH.toLowerCase());
    });

    it("should match direct RPC call result", async () => {
      const directTx = await withRetry(() =>
        mainnetPublicClient.getTransaction({
          hash: KNOWN_TX_HASH as `0x${string}`,
        })
      );

      const toolResult = await withRetry(() =>
        getTransaction.execute(testClient, {
          hash: KNOWN_TX_HASH,
          chainId: 1,
        })
      );

      expect(toolResult.hash.toLowerCase()).toBe(directTx.hash.toLowerCase());
      expect(toolResult.from.toLowerCase()).toBe(directTx.from.toLowerCase());
    });
  });

  describe("getTransactionReceipt", () => {
    const KNOWN_TX_HASH = "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060";

    it("should get transaction receipt on mainnet", async () => {
      const result = await withRetry(() =>
        getTransactionReceipt.execute(testClient, {
          hash: KNOWN_TX_HASH,
          chainId: 1,
        })
      );

      expect(result).toHaveProperty("transactionHash");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("blockNumber");
      expect(result).toHaveProperty("gasUsed");
      expect(result.transactionHash.toLowerCase()).toBe(KNOWN_TX_HASH.toLowerCase());
    });

    it("should include logs in receipt", async () => {
      // Use a transaction that has logs (token transfer)
      // This is a known USDC transfer on mainnet
      const TX_WITH_LOGS = "0x88df016429689c079f3b2f6ad39fa052532c56795b733da78a91ebe6a713944b";

      const result = await withRetry(() =>
        getTransactionReceipt.execute(testClient, {
          hash: TX_WITH_LOGS,
          chainId: 1,
        })
      );

      expect(result).toHaveProperty("logs");
      expect(Array.isArray(result.logs)).toBe(true);
    });

    it("should match direct RPC call result", async () => {
      const directReceipt = await withRetry(() =>
        mainnetPublicClient.getTransactionReceipt({
          hash: KNOWN_TX_HASH as `0x${string}`,
        })
      );

      const toolResult = await withRetry(() =>
        getTransactionReceipt.execute(testClient, {
          hash: KNOWN_TX_HASH,
          chainId: 1,
        })
      );

      expect(toolResult.transactionHash.toLowerCase()).toBe(
        directReceipt.transactionHash.toLowerCase()
      );
      expect(toolResult.blockNumber).toBe(directReceipt.blockNumber.toString());
    });
  });

  describe("Tool collection structure", () => {
    it("should have all expected tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("getBalance");
      expect(toolNames).toContain("getCode");
      expect(toolNames).toContain("getTransactionCount");
      expect(toolNames).toContain("getBlock");
      expect(toolNames).toContain("getBlockNumber");
      expect(toolNames).toContain("getGasPrice");
      expect(toolNames).toContain("estimateGas");
      expect(toolNames).toContain("getFeeHistory");
      expect(toolNames).toContain("getTransaction");
      expect(toolNames).toContain("getTransactionReceipt");
    });

    it("should have correct parameter schemas", () => {
      // Verify getBalance parameters
      const getBalanceParsed = getBalance.parameters.safeParse({
        address: TEST_ADDRESSES.vitalik,
        chainId: 8453,
        formatEth: true,
      });
      expect(getBalanceParsed.success).toBe(true);

      // Verify getBlock parameters
      const getBlockParsed = getBlock.parameters.safeParse({
        blockNumber: 1000000,
        chainId: 8453,
      });
      expect(getBlockParsed.success).toBe(true);

      // Verify getFeeHistory parameters
      const getFeeHistoryParsed = getFeeHistory.parameters.safeParse({
        blockCount: 5,
        rewardPercentiles: [25, 50, 75],
        chainId: 8453,
      });
      expect(getFeeHistoryParsed.success).toBe(true);
    });

    it("should accept getBlock without blockNumber (optional)", () => {
      const getBlockParsed = getBlock.parameters.safeParse({
        chainId: 8453,
      });
      expect(getBlockParsed.success).toBe(true);
    });

    it("should reject invalid parameters", () => {
      // Missing required chainId for getBlock
      const getBlockParsed = getBlock.parameters.safeParse({
        blockNumber: 1000000,
      });
      expect(getBlockParsed.success).toBe(false);

      // Missing required hash for getTransaction
      const getTransactionParsed = getTransaction.parameters.safeParse({
        chainId: 1,
      });
      expect(getTransactionParsed.success).toBe(false);
    });
  });

  describe("Error handling", () => {
    it("should throw error for invalid chain", async () => {
      await expect(
        getBalance.execute(testClient, {
          address: TEST_ADDRESSES.vitalik,
          chainId: 999999, // Non-existent chain
        })
      ).rejects.toThrow();
    });

    it("should throw error for invalid transaction hash", async () => {
      await expect(
        getTransaction.execute(testClient, {
          hash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          chainId: 1,
        })
      ).rejects.toThrow();
    });
  });
});
