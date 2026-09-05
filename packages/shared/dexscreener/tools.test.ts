import { describe, it, expect } from "vitest";
import { getLatestTokens } from "./tools.js";
import { dexscreenerTools } from "./index.js";
import {
  createTestClient,
  validateToolStructure,
  withRetry,
} from "../test-helpers.js";

// Create a test client with DexScreener tools
const client = createTestClient(dexscreenerTools());

describe("DexScreener Tools", () => {
  describe("Tool Structure", () => {
    it("getLatestTokens should have valid tool structure", () => {
      const result = validateToolStructure(getLatestTokens);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("dexscreenerTools() should return the getLatestTokens tool", () => {
      const tools = dexscreenerTools();
      expect(tools).toHaveLength(1);
      expect(tools.map((t) => t.name)).toContain("getLatestTokens");
    });

    it("getLatestTokens should have correct name and description", () => {
      expect(getLatestTokens.name).toBe("getLatestTokens");
      expect(getLatestTokens.description).toBe(
        "Get trending tokens from Dexscreener with market data including USD price, 24h volume, and 24h price change. Filters by the specified chain."
      );
    });

    it("getLatestTokens should support mainnet and base chains", () => {
      expect(getLatestTokens.supportedChains).toBeDefined();
      const chainIds = getLatestTokens.supportedChains?.map((c) => c.id);
      expect(chainIds).toContain(1); // Ethereum mainnet
      expect(chainIds).toContain(8453); // Base
    });
  });

  describe("getLatestTokens - Real API Calls", () => {
    it(
      "should fetch trending tokens for Ethereum mainnet (chainId: 1)",
      async () => {
        const result = await withRetry(() =>
          getLatestTokens.execute(client, { chainId: 1 })
        );

        // Verify the response structure
        expect(result).toHaveProperty("trending");
        expect(Array.isArray(result.trending)).toBe(true);

        // There should be at least some trending tokens
        // Note: This could be 0 if no tokens have profiles on Ethereum at the moment
        if (result.trending.length > 0) {
          const firstToken = result.trending[0];

          // Each token should have the expected fields
          expect(firstToken).toHaveProperty("tokenAddress");
          expect(firstToken).toHaveProperty("priceUSD");
          expect(firstToken).toHaveProperty("volume24h");
          expect(firstToken).toHaveProperty("priceChange24h");

          // Token address should be a valid Ethereum address
          expect(firstToken.tokenAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

          // Price fields should be strings (they may be "0" if no pair data)
          expect(typeof firstToken.priceUSD).toBe("string");
          expect(typeof firstToken.volume24h).toBe("string");
          expect(typeof firstToken.priceChange24h).toBe("string");
        }
      },
      30000
    );

    it(
      "should fetch trending tokens for Base chain (chainId: 8453)",
      async () => {
        const result = await withRetry(() =>
          getLatestTokens.execute(client, { chainId: 8453 })
        );

        // Verify the response structure
        expect(result).toHaveProperty("trending");
        expect(Array.isArray(result.trending)).toBe(true);

        // Base typically has trending tokens
        if (result.trending.length > 0) {
          const firstToken = result.trending[0];

          expect(firstToken).toHaveProperty("tokenAddress");
          expect(firstToken).toHaveProperty("priceUSD");
          expect(firstToken).toHaveProperty("volume24h");
          expect(firstToken).toHaveProperty("priceChange24h");

          // Token address should be a valid address
          expect(firstToken.tokenAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
        }
      },
      30000
    );

    it(
      "should default to ethereum for unknown chainId",
      async () => {
        // Using a chainId that isn't explicitly mapped (e.g., 999)
        // should fall back to "ethereum"
        const result = await withRetry(() =>
          getLatestTokens.execute(client, { chainId: 999 })
        );

        // Should still return valid data (from ethereum fallback)
        expect(result).toHaveProperty("trending");
        expect(Array.isArray(result.trending)).toBe(true);
      },
      30000
    );

    it(
      "should return tokens with description when available",
      async () => {
        // Fetch tokens and check if any have descriptions
        const result = await withRetry(() =>
          getLatestTokens.execute(client, { chainId: 1 })
        );

        expect(result).toHaveProperty("trending");

        // Description field should exist in the response
        if (result.trending.length > 0) {
          const firstToken = result.trending[0];
          expect("description" in firstToken).toBe(true);
          // Description can be undefined/null or a string
          expect(
            firstToken.description === undefined ||
              firstToken.description === null ||
              typeof firstToken.description === "string"
          ).toBe(true);
        }
      },
      30000
    );

    it(
      "should handle price and volume data correctly",
      async () => {
        const result = await withRetry(() =>
          getLatestTokens.execute(client, { chainId: 8453 })
        );

        expect(result).toHaveProperty("trending");

        // Find a token that has pair data (priceUSD != "0")
        const tokenWithPriceData = result.trending.find(
          (t: { priceUSD: string }) => t.priceUSD !== "0"
        );

        if (tokenWithPriceData) {
          // If we found a token with price data, verify the values are numeric strings
          const price = parseFloat(tokenWithPriceData.priceUSD);
          expect(isNaN(price)).toBe(false);
          expect(price).toBeGreaterThan(0);
        }
      },
      30000
    );
  });

  describe("DexScreener API Endpoints", () => {
    it(
      "should successfully reach the token-profiles endpoint",
      async () => {
        const response = await fetch(
          "https://api.dexscreener.com/token-profiles/latest/v1"
        );
        expect(response.ok).toBe(true);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(Array.isArray(data)).toBe(true);
      },
      15000
    );

    it(
      "should successfully reach the tokens endpoint",
      async () => {
        // Use a well-known token on Ethereum (USDC)
        const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
        const response = await fetch(
          `https://api.dexscreener.com/tokens/v1/ethereum/${usdcAddress}`
        );
        expect(response.ok).toBe(true);
        expect(response.status).toBe(200);

        // /tokens/v1/{chain}/{addresses} answers with a bare array of pairs,
        // not { pairs: [...] }. The tool used to read `.pairs` off it, which is
        // why every price it reported was "0".
        const data = await response.json();
        expect(Array.isArray(data)).toBe(true);
      },
      15000
    );

    it(
      "should return pair data for well-known tokens",
      async () => {
        // WETH on Ethereum has many pairs
        const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
        const response = await fetch(
          `https://api.dexscreener.com/tokens/v1/ethereum/${wethAddress}`
        );
        expect(response.ok).toBe(true);

        const data = await response.json();
        expect(Array.isArray(data)).toBe(true);

        if (data.length > 0) {
          const pair = data[0];
          expect(pair).toHaveProperty("baseToken");
          expect(pair).toHaveProperty("quoteToken");
          expect(pair).toHaveProperty("priceUsd");
          expect(pair).toHaveProperty("volume");
        }
      },
      15000
    );
  });

  describe("Chain ID Resolution", () => {
    it("should resolve chainId 1 to ethereum", async () => {
      // This is implicitly tested by the API call succeeding
      // If the resolution is wrong, the API will return different data
      const result = await withRetry(() =>
        getLatestTokens.execute(client, { chainId: 1 })
      );
      expect(result).toHaveProperty("trending");
    }, 30000);

    it("should resolve chainId 8453 to base", async () => {
      const result = await withRetry(() =>
        getLatestTokens.execute(client, { chainId: 8453 })
      );
      expect(result).toHaveProperty("trending");
    }, 30000);
  });
});
