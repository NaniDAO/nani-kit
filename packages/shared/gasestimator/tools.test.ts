import { describe, it, expect, vi, beforeEach } from "vitest";
import { estimateGasCostTool } from "./tools.js";
import type { AgentekClient } from "../client.js";

describe("estimateGasCostTool", () => {
  let mockClient: AgentekClient;
  
  beforeEach(() => {
    // Mock client with necessary methods
    mockClient = {
      getPublicClient: vi.fn().mockReturnValue({
        estimateFeesPerGas: vi.fn().mockResolvedValue({
          maxFeePerGas: BigInt(2000000000), // 2 gwei
          maxPriorityFeePerGas: BigInt(1000000000) // 1 gwei
        }),
        getGasPrice: vi.fn().mockResolvedValue(BigInt(2000000000)) // 2 gwei
      }),
      getTools: vi.fn().mockReturnValue({
        getCryptoPrice: {
          execute: vi.fn().mockResolvedValue({ price: 3000 }) // Mock ETH at $3000
        }
      })
    } as unknown as AgentekClient;
  });

  it("should estimate gas cost correctly for Ethereum mainnet", async () => {
    const args = {
      chainId: 1,
      gasUnits: 21000 // Standard ETH transfer gas
    };

    const result = await estimateGasCostTool.execute(mockClient, args);
    
    expect(result).toMatchObject({
      chainId: 1,
      gasUnits: 21000,
      maxFeePerGas: "2",
      maxPriorityFeePerGas: "1",
      nativeSymbol: "ETH"
    });
    
    // gas units × the chain's live fee: (21000 * 2 gwei) = 42000 gwei
    expect(parseFloat(result.totalCost)).toBeCloseTo(0.000042);
    
    // Check USD calculation (0.000042 ETH * $3000 = $0.126)
    // Note: getCryptoPrice is mocked and the mock returns $3000 for ETH price
    expect(parseFloat(result.usdCost!)).toBeCloseTo(0.126, 0); // Using lower precision
  });

  it("should estimate gas cost correctly for Polygon", async () => {
    const args = {
      chainId: 137,
      gasUnits: 21000 // Standard transfer gas
    };

    const result = await estimateGasCostTool.execute(mockClient, args);
    
    expect(result).toMatchObject({
      chainId: 137,
      gasUnits: 21000,
      maxFeePerGas: "2",
      maxPriorityFeePerGas: "1",
      nativeSymbol: "MATIC"
    });
    
    // Same gas price as mainnet in this mock, so the same cost: the estimate is
    // gas units × the chain's own live fee. It used to be divided again by a
    // hard-coded "Polygon is ~100x cheaper" factor, which this test asserted
    // and which understated every non-mainnet chain.
    // (21000 * 2 gwei) = 42000 gwei = 0.000042 POL
    expect(parseFloat(result.totalCost)).toBeCloseTo(0.000042, 8);
  });

  it("should use provided gas values when specified", async () => {
    const args = {
      chainId: 1,
      gasUnits: 21000,
      maxFeePerGas: "5", // 5 gwei
      maxPriorityFeePerGas: "2" // 2 gwei
    };

    const result = await estimateGasCostTool.execute(mockClient, args);
    
    expect(result.maxFeePerGas).toBe("5");
    expect(result.maxPriorityFeePerGas).toBe("2");
    
    // (21000 * 5 gwei * 1000 / 1000) = 105000 gwei = 0.000105 ETH
    expect(parseFloat(result.totalCost)).toBeCloseTo(0.000105, 5);
  });
});