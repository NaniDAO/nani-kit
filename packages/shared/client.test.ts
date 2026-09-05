import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentekClient, createAgentekClient } from "./client.js";
import { mainnet, sepolia } from "viem/chains";
import { http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import z from "zod";
import { resolveTransports } from "./chains/config.js";

describe("AgentekClient", () => {
  let client: AgentekClient;
  const mockTool = {
    name: "mockTool",
    description: "A mock tool for testing",
    parameters: z.object({
      param1: z.string(),
    }),
    execute: vi.fn().mockResolvedValue("mock result"),
    supportedChains: [mainnet],
  };

  beforeEach(() => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    client = createAgentekClient({
      transports: resolveTransports([mainnet, sepolia]),
      chains: [mainnet, sepolia],
      accountOrAddress: account,
      tools: [mockTool],
    });
  });

  it("should initialize with correct chains", () => {
    const chains = client.getChains();
    expect(chains).toHaveLength(2);
    expect(chains[0]!.id).toBe(mainnet.id);
    expect(chains[1]!.id).toBe(sepolia.id);
  });

  it("should get public client for specific chain", () => {
    const publicClient = client.getPublicClient(mainnet.id);
    expect(publicClient).toBeDefined();
    expect(publicClient.chain!.id).toBe(mainnet.id);
  });

  it("should throw error for unsupported chain", () => {
    expect(() => client.getPublicClient(999999)).toThrow(
      "No public client for chain 999999",
    );
  });

  it("should execute tool with valid parameters and return correct result", async () => {
    const result = await client.execute("mockTool", { param1: "test" });
    expect(mockTool.execute).toHaveBeenCalled();
    expect(result).toBe("mock result");
  });

  it("should throw error for invalid parameters", async () => {
    await expect(client.execute("mockTool", {})).rejects.toThrow();
  });
});
