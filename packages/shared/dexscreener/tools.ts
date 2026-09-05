import { base, mainnet } from "viem/chains";
import { AgentekClient, createTool } from "../client.js";
import z from "zod";
import { assertOkResponse } from "../utils/fetch.js";

const REQUEST_TIMEOUT_MS = 15_000;

/** The shape of one entry from /tokens/v1/{chain}/{addresses}. */
type PairInfo = {
  pairAddress?: string;
  dexId?: string;
  priceUsd?: string;
  baseToken?: { address?: string };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
};

const getLatestTokensParameters = z.object({
  chainId: z.number().describe("Chain ID to fetch trending tokens for (1 for Ethereum, 8453 for Base)"),
});

// This helper maps numeric chain IDs to the corresponding Dexscreener chain identifier.
// Modify the mappings below as needed.
const resolveChainId = (chainId: number) => {
  switch (chainId) {
    case 1:
      return "ethereum";
    case 8453:
      return "base";
    // Add more mappings for other chains as required.
    default:
      // Falling through to "ethereum" meant a request for an unsupported chain
      // silently answered with Ethereum data.
      throw new Error(
        `Chain ${chainId} is not mapped to a DexScreener chain. Supported: 1 (ethereum), 8453 (base).`,
      );
  }
};

export const getLatestTokens = createTool({
  name: "getLatestTokens",
  description: "Get trending tokens from Dexscreener with market data including USD price, 24h volume, and 24h price change. Filters by the specified chain.",
  parameters: getLatestTokensParameters,
  supportedChains: [mainnet, base],
  execute: async (
    _client: AgentekClient,
    args: z.infer<typeof getLatestTokensParameters>,
  ) => {
    // Resolve the Dexscreener chain identifier from the provided chainId.
    const dexChain = resolveChainId(args.chainId);

    // Fetch token profiles from Dexscreener.
    const profileResponse = await fetch(
      "https://api.dexscreener.com/token-profiles/latest/v1",
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    await assertOkResponse(profileResponse, "Failed to fetch token profiles");
    let profileData = await profileResponse.json();

    // Filter the token profiles by the resolved chain identifier.
    profileData = profileData.filter(
      (token: { chainId: string }) =>
        token.chainId.toLowerCase() === dexChain.toLowerCase(),
    );

    // Nothing on this chain in the latest profiles. The pair endpoint 404s on
    // an empty address list, which used to surface as "Failed to fetch pair
    // data: 404" — an error, for what is really an empty result.
    if (profileData.length === 0) {
      return {
        chainId: args.chainId,
        trending: [],
        note: `No ${dexChain} tokens in DexScreener's latest token profiles right now.`,
      };
    }

    // Build a comma-separated list of token addresses.
    const tokenAddresses = profileData
      .map((token: { tokenAddress: string }) => token.tokenAddress)
      .join(",");

    // Build the pair data endpoint URL using the resolved chain.
    const pairUrl = `https://api.dexscreener.com/tokens/v1/${dexChain}/${tokenAddresses}`;
    const pairResponse = await fetch(pairUrl, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await assertOkResponse(pairResponse, "Failed to fetch pair data");

    // /tokens/v1/{chain}/{addresses} returns a bare array of pairs. Reading
    // `.pairs` off it always short-circuited to undefined, so every token fell
    // through to the "0" defaults below and the market data was never real.
    const pairs: PairInfo[] = await pairResponse.json();

    // Map the token profiles and enrich them with their corresponding pair information.
    return {
      chainId: args.chainId,
      trending: profileData.map(
        (token: { tokenAddress: string; description?: string }) => {
          // A token can have several pairs; the deepest liquidity is the one
          // whose price is worth quoting.
          const matches = pairs.filter(
            (pair) =>
              pair.baseToken?.address?.toLowerCase() ===
              token.tokenAddress.toLowerCase(),
          );
          const pairInfo = matches.sort(
            (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
          )[0];

          return {
            tokenAddress: token.tokenAddress,
            description: token.description,
            priceUSD: pairInfo?.priceUsd ?? null,
            volume24h: pairInfo?.volume?.h24 ?? null,
            priceChange24h: pairInfo?.priceChange?.h24 ?? null,
            liquidityUSD: pairInfo?.liquidity?.usd ?? null,
            pairAddress: pairInfo?.pairAddress ?? null,
            dexId: pairInfo?.dexId ?? null,
          };
        },
      ),
    };
  },
});
