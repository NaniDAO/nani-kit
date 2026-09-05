import { describe, it, expect } from "vitest";
import { createPublicClient, http, parseEther, encodeFunctionData, isAddress, isHex } from "viem";
import { mainnet, base } from "viem/chains";
import { wethTools } from "./index.js";
import { intentDepositWETH, intentWithdrawWETH } from "./intents.js";
import { WETH_ADDRESS, wethAbi, supportedChains } from "./constants.js";
import { resolveTransports } from "../chains/config.js";
import {
  createTestClient,
  createReadOnlyTestClient,
  validateIntent,
  validateToolStructure,
  TEST_ADDRESSES,
} from "../test-helpers.js";

describe("WETH Tools", () => {
  describe("wethTools Collection", () => {
    const tools = wethTools();

    it("should include all WETH tools", () => {
      const expectedTools = [intentDepositWETH, intentWithdrawWETH];

      expect(tools).toHaveLength(expectedTools.length);

      expectedTools.forEach((tool) => {
        expect(tools).toContainEqual(
          expect.objectContaining({
            name: tool.name,
            description: tool.description,
          }),
        );
      });
    });

    it("should have unique tool names", () => {
      const toolNames = tools.map((tool) => tool.name);
      const uniqueNames = new Set(toolNames);
      expect(toolNames.length).toBe(uniqueNames.size);
    });

    it("should have valid tool structures", () => {
      tools.forEach((tool) => {
        const validation = validateToolStructure(tool);
        expect(validation.valid).toBe(true);
        if (!validation.valid) {
          console.error(validation.errors);
        }
      });
    });
  });

  describe("WETH Constants", () => {
    it("should have valid WETH addresses for all supported chains", () => {
      supportedChains.forEach((chain) => {
        const address = WETH_ADDRESS[chain.id as keyof typeof WETH_ADDRESS];
        expect(address).toBeDefined();
        expect(isAddress(address)).toBe(true);
      });
    });

    it("should have correct mainnet WETH address", () => {
      expect(WETH_ADDRESS[mainnet.id]).toBe("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
    });

    it("should have correct base WETH address", () => {
      expect(WETH_ADDRESS[base.id]).toBe("0x4200000000000000000000000000000000000006");
    });

    it("should have valid deposit and withdraw functions in ABI", () => {
      const depositFn = wethAbi.find((fn) => fn.name === "deposit");
      const withdrawFn = wethAbi.find((fn) => fn.name === "withdraw");

      expect(depositFn).toBeDefined();
      expect(depositFn?.stateMutability).toBe("payable");
      expect(depositFn?.inputs).toEqual([]);

      expect(withdrawFn).toBeDefined();
      expect(withdrawFn?.stateMutability).toBe("nonpayable");
      expect(withdrawFn?.inputs).toHaveLength(1);
      expect(withdrawFn?.inputs[0].type).toBe("uint256");
    });
  });

  describe("intentDepositWETH", () => {
    it("should have correct tool metadata", () => {
      expect(intentDepositWETH.name).toBe("depositWETH");
      expect(intentDepositWETH.description).toContain("Wrap native ETH");
      expect(intentDepositWETH.supportedChains).toEqual(supportedChains);
    });

    it("should generate valid intent for mainnet deposit", async () => {
      const client = createReadOnlyTestClient(wethTools(), [mainnet]);
      const amount = "0.1";

      const result = await intentDepositWETH.execute(client, {
        chainId: mainnet.id,
        amount,
      });

      // Validate intent structure
      const validation = validateIntent(result);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error(validation.errors);
      }

      // Check intent fields
      expect(result.intent).toContain("Deposit");
      expect(result.intent).toContain(amount.toString());
      expect(result.chain).toBe(mainnet.id);

      // Check ops structure
      expect(result.ops).toHaveLength(1);
      const op = result.ops[0];
      expect(op.target).toBe(WETH_ADDRESS[mainnet.id]);
      expect(op.value).toBe(parseEther(amount.toString()).toString());

      // Verify correct function call data
      const expectedData = encodeFunctionData({
        abi: wethAbi,
        functionName: "deposit",
        args: [],
      });
      expect(op.data).toBe(expectedData);
    });

    it("should generate valid intent for base deposit", async () => {
      const client = createReadOnlyTestClient(wethTools(), [base]);
      const amount = "0.5";

      const result = await intentDepositWETH.execute(client, {
        chainId: base.id,
        amount,
      });

      // Validate intent structure
      const validation = validateIntent(result);
      expect(validation.valid).toBe(true);

      // Check chain-specific address
      expect(result.ops[0].target).toBe(WETH_ADDRESS[base.id]);
      expect(result.chain).toBe(base.id);
    });

    it("should handle different deposit amounts correctly", async () => {
      const client = createReadOnlyTestClient(wethTools(), [mainnet]);

      const testAmounts = ["0.001", "0.1", "1", "10", "100.5"];

      for (const amount of testAmounts) {
        const result = await intentDepositWETH.execute(client, {
          chainId: mainnet.id,
          amount,
        });

        expect(result.ops[0].value).toBe(parseEther(amount).toString());
        expect(result.intent).toContain(amount);
      }
    });

    it("should not include hash when no wallet client", async () => {
      const client = createReadOnlyTestClient(wethTools(), [mainnet]);

      const result = await intentDepositWETH.execute(client, {
        chainId: mainnet.id,
        amount: "0.1",
      });

      expect(result.hash).toBeUndefined();
    });
  });

  describe("intentWithdrawWETH", () => {
    it("should have correct tool metadata", () => {
      expect(intentWithdrawWETH.name).toBe("withdrawWETH");
      expect(intentWithdrawWETH.description).toContain("Unwrap WETH");
      expect(intentWithdrawWETH.supportedChains).toEqual(supportedChains);
    });

    it("should generate valid intent for mainnet withdrawal", async () => {
      const client = createReadOnlyTestClient(wethTools(), [mainnet]);
      const amount = "0.1";

      const result = await intentWithdrawWETH.execute(client, {
        chainId: mainnet.id,
        amount,
      });

      // Validate intent structure
      const validation = validateIntent(result);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error(validation.errors);
      }

      // Check intent fields
      expect(result.intent).toContain("Withdraw");
      expect(result.intent).toContain(amount.toString());
      expect(result.chain).toBe(mainnet.id);

      // Check ops structure
      expect(result.ops).toHaveLength(1);
      const op = result.ops[0];
      expect(op.target).toBe(WETH_ADDRESS[mainnet.id]);
      expect(op.value).toBe("0");

      // Verify correct function call data
      const expectedData = encodeFunctionData({
        abi: wethAbi,
        functionName: "withdraw",
        args: [parseEther(amount.toString())],
      });
      expect(op.data).toBe(expectedData);
    });

    it("should generate valid intent for base withdrawal", async () => {
      const client = createReadOnlyTestClient(wethTools(), [base]);
      const amount = "0.5";

      const result = await intentWithdrawWETH.execute(client, {
        chainId: base.id,
        amount,
      });

      // Validate intent structure
      const validation = validateIntent(result);
      expect(validation.valid).toBe(true);

      // Check chain-specific address
      expect(result.ops[0].target).toBe(WETH_ADDRESS[base.id]);
      expect(result.chain).toBe(base.id);
    });

    it("should handle different withdrawal amounts correctly", async () => {
      const client = createReadOnlyTestClient(wethTools(), [mainnet]);

      const testAmounts = ["0.001", "0.1", "1", "10", "100.5"];

      for (const amount of testAmounts) {
        const result = await intentWithdrawWETH.execute(client, {
          chainId: mainnet.id,
          amount,
        });

        const expectedData = encodeFunctionData({
          abi: wethAbi,
          functionName: "withdraw",
          args: [parseEther(amount)],
        });

        expect(result.ops[0].data).toBe(expectedData);
        expect(result.ops[0].value).toBe("0");
        expect(result.intent).toContain(amount);
      }
    });

    it("should not include hash when no wallet client", async () => {
      const client = createReadOnlyTestClient(wethTools(), [mainnet]);

      const result = await intentWithdrawWETH.execute(client, {
        chainId: mainnet.id,
        amount: "0.1",
      });

      expect(result.hash).toBeUndefined();
    });
  });

  describe("WETH Contract Read Operations", () => {
    const publicClient = createPublicClient({
      chain: mainnet,
      transport: resolveTransports([mainnet])[0],
    });

    const basePublicClient = createPublicClient({
      chain: base,
      transport: resolveTransports([base])[0],
    });

    // Extended ABI for read operations
    const wethReadAbi = [
      {
        type: "function",
        name: "name",
        stateMutability: "view",
        outputs: [{ type: "string" }],
        inputs: [],
      },
      {
        type: "function",
        name: "symbol",
        stateMutability: "view",
        outputs: [{ type: "string" }],
        inputs: [],
      },
      {
        type: "function",
        name: "decimals",
        stateMutability: "view",
        outputs: [{ type: "uint8" }],
        inputs: [],
      },
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        outputs: [{ type: "uint256" }],
        inputs: [{ name: "account", type: "address" }],
      },
      {
        type: "function",
        name: "allowance",
        stateMutability: "view",
        outputs: [{ type: "uint256" }],
        inputs: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
        ],
      },
      {
        type: "function",
        name: "totalSupply",
        stateMutability: "view",
        outputs: [{ type: "uint256" }],
        inputs: [],
      },
    ] as const;

    it("should verify mainnet WETH contract is WETH", async () => {
      const name = await publicClient.readContract({
        address: WETH_ADDRESS[mainnet.id],
        abi: wethReadAbi,
        functionName: "name",
      });

      const symbol = await publicClient.readContract({
        address: WETH_ADDRESS[mainnet.id],
        abi: wethReadAbi,
        functionName: "symbol",
      });

      const decimals = await publicClient.readContract({
        address: WETH_ADDRESS[mainnet.id],
        abi: wethReadAbi,
        functionName: "decimals",
      });

      expect(name).toBe("Wrapped Ether");
      expect(symbol).toBe("WETH");
      expect(decimals).toBe(18);
    });

    it("should verify base WETH contract is WETH", async () => {
      const name = await basePublicClient.readContract({
        address: WETH_ADDRESS[base.id],
        abi: wethReadAbi,
        functionName: "name",
      });

      const symbol = await basePublicClient.readContract({
        address: WETH_ADDRESS[base.id],
        abi: wethReadAbi,
        functionName: "symbol",
      });

      const decimals = await basePublicClient.readContract({
        address: WETH_ADDRESS[base.id],
        abi: wethReadAbi,
        functionName: "decimals",
      });

      expect(name).toBe("Wrapped Ether");
      expect(symbol).toBe("WETH");
      expect(decimals).toBe(18);
    });

    it("should query WETH balance for a known address on mainnet", async () => {
      const balance = await publicClient.readContract({
        address: WETH_ADDRESS[mainnet.id],
        abi: wethReadAbi,
        functionName: "balanceOf",
        args: [TEST_ADDRESSES.vitalik],
      });

      // Vitalik likely has some WETH, but we just verify it returns a valid bigint
      expect(typeof balance).toBe("bigint");
      expect(balance >= 0n).toBe(true);
    });

    it("should query WETH balance for a known address on base", async () => {
      const balance = await basePublicClient.readContract({
        address: WETH_ADDRESS[base.id],
        abi: wethReadAbi,
        functionName: "balanceOf",
        args: [TEST_ADDRESSES.vitalik],
      });

      expect(typeof balance).toBe("bigint");
      expect(balance >= 0n).toBe(true);
    });

    it("should query WETH allowance between two addresses", async () => {
      const allowance = await publicClient.readContract({
        address: WETH_ADDRESS[mainnet.id],
        abi: wethReadAbi,
        functionName: "allowance",
        args: [TEST_ADDRESSES.vitalik, TEST_ADDRESSES.uniswapRouter],
      });

      expect(typeof allowance).toBe("bigint");
      expect(allowance >= 0n).toBe(true);
    });

    it("should query WETH total supply on mainnet", async () => {
      const totalSupply = await publicClient.readContract({
        address: WETH_ADDRESS[mainnet.id],
        abi: wethReadAbi,
        functionName: "totalSupply",
      });

      // Total supply should be significant
      expect(typeof totalSupply).toBe("bigint");
      expect(totalSupply > 0n).toBe(true);
      // WETH total supply should be at least 1000 ETH worth (very conservative)
      expect(totalSupply > parseEther("1000")).toBe(true);
    });

    it("should query WETH total supply on base", async () => {
      const totalSupply = await basePublicClient.readContract({
        address: WETH_ADDRESS[base.id],
        abi: wethReadAbi,
        functionName: "totalSupply",
      });

      expect(typeof totalSupply).toBe("bigint");
      expect(totalSupply > 0n).toBe(true);
    });
  });

  describe("Client Integration", () => {
    it("should execute depositWETH via client.execute", async () => {
      const client = createReadOnlyTestClient(wethTools(), [mainnet, base]);

      const result = await client.execute("depositWETH", {
        chainId: mainnet.id,
        amount: "0.1",
      });

      expect(result.intent).toContain("Deposit");
      expect(result.chain).toBe(mainnet.id);
      expect(result.ops).toHaveLength(1);
    });

    it("should execute withdrawWETH via client.execute", async () => {
      const client = createReadOnlyTestClient(wethTools(), [mainnet, base]);

      const result = await client.execute("withdrawWETH", {
        chainId: mainnet.id,
        amount: "0.1",
      });

      expect(result.intent).toContain("Withdraw");
      expect(result.chain).toBe(mainnet.id);
      expect(result.ops).toHaveLength(1);
    });

    it("should reject unsupported chain for depositWETH", async () => {
      const client = createReadOnlyTestClient(wethTools(), [mainnet]);

      // Chain 999 is not supported
      await expect(
        client.execute("depositWETH", {
          chainId: 999,
          amount: "0.1",
        }),
      ).rejects.toThrow();
    });

    it("should reject unsupported chain for withdrawWETH", async () => {
      const client = createReadOnlyTestClient(wethTools(), [mainnet]);

      await expect(
        client.execute("withdrawWETH", {
          chainId: 999,
          amount: "0.1",
        }),
      ).rejects.toThrow();
    });

    it("should validate parameters for depositWETH", async () => {
      const client = createReadOnlyTestClient(wethTools(), [mainnet]);

      // Missing required parameters
      await expect(
        client.execute("depositWETH", {
          chainId: mainnet.id,
          // amount is missing
        }),
      ).rejects.toThrow();
    });

    it("should validate parameters for withdrawWETH", async () => {
      const client = createReadOnlyTestClient(wethTools(), [mainnet]);

      // Missing required parameters
      await expect(
        client.execute("withdrawWETH", {
          // chainId is missing
          amount: "0.1",
        }),
      ).rejects.toThrow();
    });
  });
});
