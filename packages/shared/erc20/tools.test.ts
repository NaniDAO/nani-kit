import { describe, it, expect } from "vitest";
import { createPublicClient, http, formatEther, erc20Abi } from "viem";
import { base } from "viem/chains";
import {
  getAllowanceTool,
  getBalanceOfTool,
  getTotalSupplyTool,
  getDecimalsTool,
  getNameTool,
  getSymbolTool,
  getTokenMetadataTool,
} from "./tools.js";
import { erc20Chains } from "./constants.js";
import { AgentekClient, createAgentekClient } from "../client.js";
import { erc20Tools } from ".";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { resolveTransports } from "../chains/config.js";

const publicClient = createPublicClient({
  chain: base,
  transport: resolveTransports([base])[0],
});

const mockClient: AgentekClient = createAgentekClient({
  transports: resolveTransports([base]),
  chains: [base],
  accountOrAddress: privateKeyToAccount(generatePrivateKey()),
  tools: erc20Tools(),
});

const TOKEN = "0x00000000000007C8612bA63Df8DdEfD9E6077c97";

describe("ERC20 Tools", () => {
  describe("getAllowanceTool", () => {
    it("should get allowance for specified chain", async () => {
      // Fetch onchain allowance
      const onchainAllowance = await publicClient.readContract({
        address: TOKEN,
        abi: erc20Abi,
        functionName: "allowance",
        args: [
          "0x0000000000001d8a2e7bf6bc369525A2654aa298",
          "0x000000000098B77284DA7dBe8Df0d554BA24DC09",
        ],
      });

      const result = await getAllowanceTool.execute(mockClient, {
        token: TOKEN,
        owner: "0x0000000000001d8a2e7bf6bc369525A2654aa298",
        spender: "0x000000000098B77284DA7dBe8Df0d554BA24DC09",
        chainId: 8453,
      });

      expect(result).toEqual([
        {
          chain: 8453,
          allowance: formatEther(onchainAllowance),
        },
      ]);
    });
  });

  describe("getBalanceOfTool", () => {
    it("should get balance for specified chain", async () => {
      // Fetch onchain balance
      const onchainBalance = await publicClient.readContract({
        address: TOKEN,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: ["0xDa000000000000d2885F108500803dfBAaB2f2aA"],
      });

      const result = await getBalanceOfTool.execute(mockClient, {
        token: TOKEN,
        owner: "0xDa000000000000d2885F108500803dfBAaB2f2aA",
        chainId: 8453,
      });

      expect(result).toEqual([
        {
          chain: 8453,
          balance: formatEther(onchainBalance),
        },
      ]);
    });
  });

  describe("getTotalSupplyTool", () => {
    it("should get total supply for specified chain", async () => {
      const onchainTotalSupply = await publicClient.readContract({
        address: TOKEN,
        abi: erc20Abi,
        functionName: "totalSupply",
      });

      const result = await getTotalSupplyTool.execute(mockClient, {
        token: TOKEN,
        chainId: 8453,
      });

      expect(result).toEqual([
        {
          chain: 8453,
          totalSupply: formatEther(onchainTotalSupply),
        },
      ]);
    });
  });

  describe("getDecimalsTool", () => {
    it("should get decimals for specified chain", async () => {
      const onchainDecimals = await publicClient.readContract({
        address: TOKEN,
        abi: erc20Abi,
        functionName: "decimals",
      });

      const result = await getDecimalsTool.execute(mockClient, {
        token: TOKEN,
        chainId: 8453,
      });

      expect(result).toEqual([
        {
          chain: 8453,
          decimals: onchainDecimals,
        },
      ]);
    });
  });

  describe("getNameTool", () => {
    it("should get name for specified chain", async () => {
      const onchainName = await publicClient.readContract({
        address: TOKEN,
        abi: erc20Abi,
        functionName: "name",
      });

      const result = await getNameTool.execute(mockClient, {
        token: TOKEN,
        chainId: 8453,
      });

      expect(result).toEqual([
        {
          chain: 8453,
          name: onchainName,
        },
      ]);
    });
  });

  describe("getSymbolTool", () => {
    it("should get symbol for specified chain", async () => {
      const onchainSymbol = await publicClient.readContract({
        address: TOKEN,
        abi: erc20Abi,
        functionName: "symbol",
      });

      const result = await getSymbolTool.execute(mockClient, {
        token: TOKEN,
        chainId: 8453,
      });

      expect(result).toEqual([
        {
          chain: 8453,
          symbol: onchainSymbol,
        },
      ]);
    });
  });

  describe("getTokenMetadataTool", () => {
    it("should get all metadata for specified chain", async () => {
      const onchainName = await publicClient.readContract({
        address: TOKEN,
        abi: erc20Abi,
        functionName: "name",
      });
      const onchainSymbol = await publicClient.readContract({
        address: TOKEN,
        abi: erc20Abi,
        functionName: "symbol",
      });
      const onchainDecimals = await publicClient.readContract({
        address: TOKEN,
        abi: erc20Abi,
        functionName: "decimals",
      });
      const onchainTotalSupply = await publicClient.readContract({
        address: TOKEN,
        abi: erc20Abi,
        functionName: "totalSupply",
      });

      const result = await getTokenMetadataTool.execute(mockClient, {
        token: TOKEN,
        chainId: 8453,
      });

      expect(result).toEqual({
        chain: 8453,
        name: onchainName,
        symbol: onchainSymbol,
        decimals: onchainDecimals,
        totalSupply: formatEther(onchainTotalSupply),
      });
    });
  });
});
