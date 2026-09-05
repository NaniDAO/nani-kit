import { describe, it, expect } from "vitest";
import { rpcTools } from "./index.js";
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
import { intentSendTransaction } from "./intents.js";

describe("RPC Tools Collection", () => {
  const tools = rpcTools();

  it("should include all RPC tools", () => {
    const expectedTools = [
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
      intentSendTransaction,
    ];

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
      expect(tool).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
        parameters: expect.any(Object),
        execute: expect.any(Function),
        supportedChains: expect.any(Array),
      });
    });
  });
});
