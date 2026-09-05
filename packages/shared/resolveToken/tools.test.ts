import { describe, it, expect } from "vitest";
import { http } from "viem";
import { mainnet, base, arbitrum, optimism } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createAgentekClient } from "../client.js";
import { resolveTokenTool } from "./tools.js";
import { resolveTokenTools } from "./index.js";
import { resolveTransports } from "../chains/config.js";

const mockClient = createAgentekClient({
  transports: resolveTransports([mainnet, base, arbitrum, optimism]),
  chains: [mainnet, base, arbitrum, optimism],
  accountOrAddress: privateKeyToAccount(generatePrivateKey()),
  tools: resolveTokenTools(),
});

describe("resolveToken", () => {
  describe("static registry", () => {
    it("should resolve USDC on mainnet", async () => {
      const result = await resolveTokenTool.execute(mockClient, {
        symbol: "USDC",
        chainId: 1,
      });
      expect(result.address).toBe(
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      );
      expect(result.decimals).toBe(6);
      expect(result.source).toBe("registry");
    });

    it("should resolve USDC on Base", async () => {
      const result = await resolveTokenTool.execute(mockClient, {
        symbol: "USDC",
        chainId: 8453,
      });
      expect(result.address).toBe(
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      );
      expect(result.decimals).toBe(6);
      expect(result.source).toBe("registry");
    });

    it("should resolve WETH on Arbitrum", async () => {
      const result = await resolveTokenTool.execute(mockClient, {
        symbol: "WETH",
        chainId: 42161,
      });
      expect(result.address).toBe(
        "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      );
      expect(result.decimals).toBe(18);
      expect(result.source).toBe("registry");
    });

    it("should be case-insensitive", async () => {
      const result = await resolveTokenTool.execute(mockClient, {
        symbol: "usdc",
        chainId: 1,
      });
      expect(result.address).toBe(
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      );
    });

    it("should resolve stETH on mainnet", async () => {
      const result = await resolveTokenTool.execute(mockClient, {
        symbol: "stETH",
        chainId: 1,
      });
      expect(result.address).toBe(
        "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
      );
      expect(result.decimals).toBe(18);
    });

    it("should resolve DAI on Polygon", async () => {
      const result = await resolveTokenTool.execute(mockClient, {
        symbol: "DAI",
        chainId: 137,
      });
      expect(result.address).toBe(
        "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
      );
      expect(result.decimals).toBe(18);
      expect(result.name).toBe("Dai Stablecoin");
    });
  });

  describe("CoinGecko fallback", () => {
    it("should resolve a token not in the static registry", async () => {
      // PEPE is not in the registry but is on CoinGecko
      const result = await resolveTokenTool.execute(mockClient, {
        symbol: "PEPE",
        chainId: 1,
      });
      expect(result.address).toBeDefined();
      expect(result.address).toMatch(/^0x/);
      expect(result.source).toBe("coingecko");
      expect(result.coingeckoId).toBeDefined();
    }, 60000);

    it("should throw for a completely unknown token", async () => {
      await expect(
        resolveTokenTool.execute(mockClient, {
          symbol: "ZZZZNOTAREAL_TOKEN_XYZ",
          chainId: 1,
        }),
      ).rejects.toThrow(/Could not resolve token/);
    }, 30000);
  });
});
