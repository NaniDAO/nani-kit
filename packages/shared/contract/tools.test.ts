import { describe, it, expect } from "vitest";
import { http, erc20Abi, encodeFunctionData } from "viem";
import { mainnet, base } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createAgentekClient } from "../client.js";
import { readContractTool, intentWriteContractTool } from "./tools.js";
import { contractTools } from "./index.js";
import { resolveTransports } from "../chains/config.js";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_MAINNET = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const TEST_ADDRESS = "0xCB0592589602B841BE035e1e64C2A5b1Ef006aa2";

const mockClient = createAgentekClient({
  transports: resolveTransports([mainnet, base]),
  chains: [mainnet, base],
  accountOrAddress: privateKeyToAccount(generatePrivateKey()),
  tools: contractTools(),
});

describe("Contract Tools", () => {
  describe("readContract", () => {
    it("should read with an explicit ABI", async () => {
      const result = await readContractTool.execute(mockClient, {
        address: USDC_BASE,
        functionName: "symbol",
        abi: erc20Abi,
        chainId: 8453,
      });

      expect(result).toBe("USDC");
    }, 30000);

    it("should read with auto-fetched ABI from Blockscout", async () => {
      const result = await readContractTool.execute(mockClient, {
        address: USDC_BASE,
        functionName: "decimals",
        chainId: 8453,
      });

      expect(result).toBe(6);
    }, 30000);

    it("should read balanceOf with args", async () => {
      const result = await readContractTool.execute(mockClient, {
        address: USDC_BASE,
        functionName: "balanceOf",
        args: [TEST_ADDRESS],
        abi: erc20Abi,
        chainId: 8453,
      });

      expect(typeof result).toBe("string"); // bigint cleaned to string
    }, 30000);

    it("should throw for unverified contract without ABI", async () => {
      const randomAddress = privateKeyToAccount(generatePrivateKey()).address;

      await expect(
        readContractTool.execute(mockClient, {
          address: randomAddress,
          functionName: "name",
          chainId: 8453,
        }),
      ).rejects.toThrow(/No ABI provided/);
    }, 30000);
  });

  describe("intentWriteContract", () => {
    it("should return an intent without wallet", async () => {
      const readOnlyClient = createAgentekClient({
        transports: resolveTransports([mainnet]),
        chains: [mainnet],
        accountOrAddress: TEST_ADDRESS,
        tools: contractTools(),
      });

      const result = await intentWriteContractTool.execute(readOnlyClient, {
        address: USDC_MAINNET,
        functionName: "transfer",
        args: [TEST_ADDRESS, "1000000"],
        abi: erc20Abi,
        chainId: 1,
      });

      expect(result).toHaveProperty("intent");
      expect(result).toHaveProperty("ops");
      expect(result).toHaveProperty("chain", 1);
      expect(result.ops).toHaveLength(1);
      expect(result.ops[0].target).toBe(USDC_MAINNET);
      expect(result.ops[0].value).toBe("0");

      const expectedData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [TEST_ADDRESS, "1000000"],
      });
      expect(result.ops[0].data).toBe(expectedData);
    });

    it("should include ETH value when specified", async () => {
      const readOnlyClient = createAgentekClient({
        transports: resolveTransports([base]),
        chains: [base],
        accountOrAddress: TEST_ADDRESS,
        tools: contractTools(),
      });

      const wethAbi = [
        {
          name: "deposit",
          type: "function",
          stateMutability: "payable",
          inputs: [],
          outputs: [],
        },
      ] as const;

      const result = await intentWriteContractTool.execute(readOnlyClient, {
        address: "0x4200000000000000000000000000000000000006",
        functionName: "deposit",
        abi: wethAbi,
        value: "1000000000000000000",
        chainId: 8453,
      });

      expect(result.ops[0].value).toBe("1000000000000000000");
    });

    it("should auto-fetch ABI for write intents", async () => {
      const readOnlyClient = createAgentekClient({
        transports: resolveTransports([base]),
        chains: [base],
        accountOrAddress: TEST_ADDRESS,
        tools: contractTools(),
      });

      const result = await intentWriteContractTool.execute(readOnlyClient, {
        address: USDC_BASE,
        functionName: "transfer",
        args: [TEST_ADDRESS, "1000000"],
        chainId: 8453,
      });

      expect(result).toHaveProperty("intent");
      expect(result.ops).toHaveLength(1);
      expect(result.ops[0].target).toBe(USDC_BASE);
    }, 30000);
  });
});
