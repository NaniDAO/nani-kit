import { describe, it, expect } from "vitest";
import { http, encodeFunctionData, erc20Abi } from "viem";
import { mainnet, base } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createAgentekClient } from "../client.js";
import {
  getActiveApprovalsTool,
  intentRevokeApprovalTool,
} from "./tools.js";
import { approvalTools } from "./index.js";
import { resolveTransports } from "../chains/config.js";

const TEST_ADDRESS = "0xCB0592589602B841BE035e1e64C2A5b1Ef006aa2";

const mockClient = createAgentekClient({
  transports: resolveTransports([mainnet, base]),
  chains: [mainnet, base],
  accountOrAddress: privateKeyToAccount(generatePrivateKey()),
  tools: approvalTools(),
});

describe("Approvals Tools", () => {
  describe("getActiveApprovals", () => {
    it("should scan approvals on Base", async () => {
      const result = await getActiveApprovalsTool.execute(mockClient, {
        owner: TEST_ADDRESS,
        chainId: 8453,
      });

      expect(result).toHaveProperty("chainId", 8453);
      expect(result).toHaveProperty("owner", TEST_ADDRESS);
      expect(result).toHaveProperty("approvals");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("scannedPairs");
      expect(Array.isArray(result.approvals)).toBe(true);
      expect(result.scannedPairs).toBeGreaterThan(0);

      // Each approval should have the expected shape
      if (result.approvals.length > 0) {
        const approval = result.approvals[0];
        expect(approval).toHaveProperty("token");
        expect(approval).toHaveProperty("tokenSymbol");
        expect(approval).toHaveProperty("spender");
        expect(approval).toHaveProperty("allowance");
        expect(approval).toHaveProperty("allowanceFormatted");
        expect(approval).toHaveProperty("isUnlimited");
        expect(approval.token).toMatch(/^0x/);
        expect(approval.spender).toMatch(/^0x/);
      }

      // Verify unlimited approvals are sorted first
      if (result.approvals.length >= 2) {
        const hasUnlimited = result.approvals.some(
          (a: any) => a.isUnlimited,
        );
        const hasLimited = result.approvals.some(
          (a: any) => !a.isUnlimited,
        );
        if (hasUnlimited && hasLimited) {
          const firstLimitedIdx = result.approvals.findIndex(
            (a: any) => !a.isUnlimited,
          );
          const lastUnlimitedIdx = result.approvals.findLastIndex(
            (a: any) => a.isUnlimited,
          );
          expect(lastUnlimitedIdx).toBeLessThan(firstLimitedIdx);
        }
      }
    }, 60000);

    it("should return empty for address with no approvals", async () => {
      const freshAddress = privateKeyToAccount(generatePrivateKey()).address;
      const result = await getActiveApprovalsTool.execute(mockClient, {
        owner: freshAddress,
        chainId: 8453,
      });

      expect(result.total).toBe(0);
      expect(result.approvals).toEqual([]);
    }, 30000);

    // Mainnet free RPC + Blockscout getLogs can exceed 120s
    it.skip("should scan approvals on Ethereum mainnet", async () => {
      const result = await getActiveApprovalsTool.execute(mockClient, {
        owner: TEST_ADDRESS,
        chainId: 1,
      });

      expect(result.chainId).toBe(1);
      expect(result.scannedPairs).toBeGreaterThan(0);
      expect(Array.isArray(result.approvals)).toBe(true);
    }, 120000);
  });

  describe("intentRevokeApproval", () => {
    it("should return a revoke intent without wallet", async () => {
      const readOnlyClient = createAgentekClient({
        transports: resolveTransports([mainnet]),
        chains: [mainnet],
        accountOrAddress: TEST_ADDRESS,
        tools: approvalTools(),
      });

      const result = await intentRevokeApprovalTool.execute(readOnlyClient, {
        token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        spender: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        chainId: 1,
      });

      expect(result).toHaveProperty("intent");
      expect(result).toHaveProperty("ops");
      expect(result).toHaveProperty("chain", 1);
      expect(result.ops).toHaveLength(1);
      expect(result.ops[0].target).toBe(
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      );

      const expectedData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: ["0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", 0n],
      });
      expect(result.ops[0].data).toBe(expectedData);
    });
  });
});
