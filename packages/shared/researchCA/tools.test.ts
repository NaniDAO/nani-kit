import { afterEach, describe, expect, it, vi } from "vitest";
import { researchCA } from "./tools.js";

const CONTRACT = "0x1111111111111111111111111111111111111111";
const OWNER = "0x2222222222222222222222222222222222222222";
const ZERO = "0x0000000000000000000000000000000000000000";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("researchCA", () => {
  it("aggregates qualified ERC-721 mint, contract, holder, and market facts", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(`/addresses/${CONTRACT}`)) {
        return jsonResponse({ is_contract: true, creation_tx_hash: "0xabc" });
      }
      if (url.includes(`/smart-contracts/${CONTRACT}`)) {
        return jsonResponse({
          is_verified: true,
          name: "TestCollection",
          is_proxy: false,
          creator_address_hash: OWNER,
          abi: [
            { type: "function", name: "mint" },
            { type: "function", name: "setBlacklist" },
          ],
        });
      }
      if (url.includes(`/tokens/${CONTRACT}/holders`)) {
        return jsonResponse({ items: [
          { address: { hash: OWNER, is_contract: false }, value: "2" },
          { address: { hash: ZERO, is_contract: false }, value: "1" },
        ] });
      }
      if (url.includes(`/tokens/${CONTRACT}/transfers`)) {
        return jsonResponse({ items: [
          { from: { hash: ZERO }, to: { hash: OWNER }, token_ids: ["1"], timestamp: "2026-08-01T00:00:00Z" },
          { from: { hash: ZERO }, to: { hash: OWNER }, token_ids: ["2"], timestamp: "2026-08-02T00:00:00Z" },
        ], next_page_params: null });
      }
      if (url.includes(`/tokens/${CONTRACT}`)) {
        return jsonResponse({ type: "ERC-721", name: "Test Collection", symbol: "TEST", total_supply: "3", holders_count: "2" });
      }
      if (url.includes("/transactions/0xabc")) {
        return jsonResponse({ timestamp: "2026-07-30T00:00:00Z" });
      }
      if (url.includes("api.dexscreener.com")) return jsonResponse([]);
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const publicClient = {
      getCode: vi.fn().mockResolvedValue("0x6000"),
      readContract: vi.fn(async ({ functionName, args }: { functionName: string; args?: string[] }) => {
        if (functionName === "supportsInterface") return args?.[0] === "0x80ac58cd";
        if (functionName === "name") return "Test Collection";
        if (functionName === "symbol") return "TEST";
        if (functionName === "totalSupply") return 3n;
        if (functionName === "owner") return OWNER;
        if (functionName === "paused") return false;
        throw new Error("not implemented");
      }),
    };
    const client = { getPublicClient: () => publicClient };

    const result = await researchCA.execute(client as never, { chainId: 1, address: CONTRACT });

    expect(result.classification.standard).toBe("ERC721");
    expect(result.contract.verified).toBe(true);
    expect(result.contract.owner).toBe(OWNER);
    expect(result.contract.abi.capabilities.mintFunctionPresent).toBe(true);
    expect(result.contract.abi.capabilities.blacklistFunctionPresent).toBe(true);
    expect(result.token.currentSupplyRaw).toBe("3");
    expect(result.mintAndTransferHistory).toMatchObject({
      complete: true,
      firstMintObservedAt: "2026-08-01T00:00:00.000Z",
      mintEventsObserved: 2,
      mintedUnitsObservedRaw: "2",
    });
    expect(result.contract.deployedAt).toBe("2026-07-30T00:00:00.000Z");
    expect(result.market.pairCount).toBe(0);
    expect(result.warnings.join(" ")).toContain("blacklist or trading-control");
  });

  it("normalizes ERC-20 liquidity and never turns unavailable sources into certainty", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.dexscreener.com")) return jsonResponse([{
        pairAddress: "0x3333333333333333333333333333333333333333",
        dexId: "uniswap",
        baseToken: { address: CONTRACT, symbol: "TOK" },
        quoteToken: { address: "0x4444444444444444444444444444444444444444", symbol: "USDC" },
        priceUsd: "0.42",
        liquidity: { usd: 12_500 },
        volume: { h24: 2_000 },
        txns: { h24: { buys: 9, sells: 4 } },
        pairCreatedAt: 1_786_060_800_000,
      }]);
      if (url.includes(`/tokens/${CONTRACT}/transfers`)) {
        return jsonResponse({ items: [], next_page_params: { block_number: 1, index: 2 } });
      }
      return jsonResponse({}, 503);
    }));
    const client = { getPublicClient: () => ({
      getCode: vi.fn().mockResolvedValue("0x6000"),
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === "decimals") return 6;
        if (functionName === "totalSupply") return 123n;
        if (functionName === "name") return "Token";
        if (functionName === "symbol") return "TOK";
        throw new Error("unsupported");
      }),
    }) };

    const result = await researchCA.execute(client as never, { chainId: 4663, address: CONTRACT });

    expect(result.chain.name).toBe("Robinhood Chain");
    expect(result.classification.standard).toBe("ERC20");
    expect(result.token.currentSupplyFormatted).toBe("0.000123");
    expect(result.market).toMatchObject({ pairCount: 1, reportedLiquidityUsdAcrossPairs: 12_500 });
    expect(result.market.pairs[0].transactions.h24.buys).toBe(9);
    expect(result.mintAndTransferHistory.complete).toBe(false);
    expect(result.contract.verified).toBeUndefined();
    expect(result.sources.some((source: { ok: boolean }) => !source.ok)).toBe(true);
  });

  it("reports unknown classification when both chain and explorer evidence are unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 503)));
    const client = { getPublicClient: () => ({
      getCode: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
      readContract: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
    }) };

    const result = await researchCA.execute(client as never, { chainId: 1, address: CONTRACT });

    expect(result.classification.standard).toBe("UNKNOWN");
    expect(result.contract.hasCode).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("classification may be unknown");
  });
});
