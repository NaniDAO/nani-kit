import { z } from "zod";
import { type AgentekClient, type BaseTool, createTool } from "../client.js";
import { clean } from "../utils.js";
import {
  getDexscreenerSolanaPairs,
  getDexscreenerSolanaProfiles,
  getDexscreenerSolanaPromotions,
  getJupiterRecentTokens,
  getJupiterSwapOrder,
  getJupiterTokenByMint,
  getJupiterTopTokens,
  resolveSolanaSwapMint,
  searchJupiterTokens,
} from "./market.js";
import { solanaAddressSchema } from "./utils.js";

const limitParameter = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Maximum results to return (1-100). Defaults to 25.");

const mintParameter = z
  .string()
  .describe("Solana token mint address, or a known symbol such as USDC, BONK, or JUP");

const swapMintParameter = z
  .string()
  .describe("Solana token mint address, or a known symbol such as SOL, USDC, BONK, or JUP");

const rawAmountParameter = z
  .string()
  .regex(/^[1-9][0-9]*$/, "Amount must be a positive integer")
  .describe("Exact input amount in the input token's smallest raw units");

const slippageParameter = z
  .number()
  .int()
  .min(1)
  .max(5000)
  .optional()
  .describe("Optional maximum slippage in basis points (1-5000)");

export const searchSolanaTokensTool = createTool({
  name: "searchSolanaTokens",
  description:
    "Search Jupiter's Solana token index by mint, symbol, or name. Returns metadata, token program, verification, audit fields, liquidity, holder counts, organic score, and rolling trading statistics when available.",
  parameters: z.object({
    query: z.string().min(1).describe("Mint address, symbol, or token name to search"),
  }),
  execute: async (client, args) =>
    clean(await searchJupiterTokens(args.query, client.getJupiterApiKey())),
});

export const getSolanaTrendingTokensTool = createTool({
  name: "getSolanaTrendingTokens",
  description:
    "Get Solana tokens ranked by Jupiter for price trend, traded volume, or organic activity over a selected window. This is a discovery signal, not an endorsement or safety verdict.",
  parameters: z.object({
    category: z
      .enum(["toptrending", "toptraded", "toporganicscore"])
      .describe("Ranking: price trend, traded volume, or organic activity"),
    interval: z.enum(["5m", "1h", "6h", "24h"]).describe("Ranking window"),
    limit: limitParameter,
  }),
  execute: async (client, args) =>
    clean(
      await getJupiterTopTokens(
        args.category,
        args.interval,
        args.limit ?? 25,
        client.getJupiterApiKey(),
      ),
    ),
});

export const getSolanaRecentTokensTool = createTool({
  name: "getSolanaRecentTokens",
  description:
    "Get recently listed Solana tokens from Jupiter, ordered by first pool creation time rather than mint creation. New listings are highly risky and require independent on-chain checks.",
  parameters: z.object({ limit: limitParameter }),
  execute: async (client, args) =>
    clean(await getJupiterRecentTokens(args.limit ?? 25, client.getJupiterApiKey())),
});

export const getSolanaTokenMarketDataTool = createTool({
  name: "getSolanaTokenMarketData",
  description:
    "Get Jupiter's exact market, holder, audit, developer, verification, liquidity, and rolling trade data for one Solana mint. Provider audit fields are evidence, not a complete security analysis.",
  parameters: z.object({ token: mintParameter }),
  execute: async (client, args) =>
    clean(await getJupiterTokenByMint(args.token, client.getJupiterApiKey())),
});

export const getSolanaLatestProfilesTool = createTool({
  name: "getSolanaLatestProfiles",
  description:
    "Get the latest Solana token profiles published on Dexscreener. A profile is promotional/discovery metadata and does not imply organic interest, liquidity, or safety.",
  parameters: z.object({ limit: limitParameter }),
  execute: async (_client, args) =>
    clean(await getDexscreenerSolanaProfiles(args.limit ?? 25)),
});

export const getSolanaPromotedTokensTool = createTool({
  name: "getSolanaPromotedTokens",
  description:
    "Get Solana tokens with the most active paid Dexscreener boosts. Results are explicitly paid promotion and must not be treated as trending, organic, or safe.",
  parameters: z.object({ limit: limitParameter }),
  execute: async (_client, args) =>
    clean(await getDexscreenerSolanaPromotions(args.limit ?? 25)),
});

export const getSolanaTokenPairsTool = createTool({
  name: "getSolanaTokenPairs",
  description:
    "Get Dexscreener market pairs for a Solana token, sorted by reported USD liquidity. Includes DEX, quote token, price, transactions, volume, liquidity, market cap, and pair age when available.",
  parameters: z.object({ token: mintParameter, limit: limitParameter }),
  execute: async (_client, args) =>
    clean(await getDexscreenerSolanaPairs(args.token, args.limit ?? 25)),
});

const swapParameters = z.object({
  inputToken: swapMintParameter,
  outputToken: swapMintParameter,
  amount: rawAmountParameter,
  slippageBps: slippageParameter,
});

export const getSolanaSwapQuoteTool = createTool({
  name: "getSolanaSwapQuote",
  description:
    "Get a quote-only exact-input Solana swap order from Jupiter Swap V2. Returns expected raw output and routing/fee data but no signable transaction and does not move funds.",
  parameters: swapParameters,
  execute: async (client, args) => {
    const order = await getJupiterSwapOrder(
      {
        inputMint: args.inputToken,
        outputMint: args.outputToken,
        amount: args.amount,
        slippageBps: args.slippageBps,
      },
      client.getJupiterApiKey(),
    );
    const { transaction: _transaction, ...quote } = order;
    return clean(quote);
  },
});

export const intentSwapSolanaTool = createTool({
  name: "intentSwapSolana",
  description:
    "Build an exact-input Jupiter Swap V2 intent for the configured Solana account. Returns the untrusted base64 transaction and request ID for an external wallet to decode, validate, simulate, approve, sign, and execute. Agentek does not sign or submit it.",
  parameters: swapParameters,
  execute: async (client: AgentekClient, args) => {
    const taker = await client.getSolanaAddress();
    const inputMint = resolveSolanaSwapMint(args.inputToken);
    const outputMint = resolveSolanaSwapMint(args.outputToken);
    const order = await getJupiterSwapOrder(
      {
        inputMint,
        outputMint,
        amount: args.amount,
        taker: solanaAddressSchema.parse(taker),
        slippageBps: args.slippageBps,
      },
      client.getJupiterApiKey(),
    );
    if (!order.transaction) {
      throw new Error("Jupiter quoted the swap but did not return a transaction");
    }

    return clean({
      intent: `swap ${args.amount} raw units of ${inputMint} for ${outputMint}`,
      chain: "solana",
      transaction: order.transaction,
      requestId: order.requestId,
      lastValidBlockHeight: order.lastValidBlockHeight,
      quote: {
        inputMint,
        outputMint,
        inputAmount: args.amount,
        outAmount: order.outAmount,
        router: order.router,
        mode: order.mode,
        feeBps: order.feeBps,
        feeMint: order.feeMint,
      },
    });
  },
});

const keylessTools: BaseTool[] = [
  getSolanaLatestProfilesTool,
  getSolanaPromotedTokensTool,
  getSolanaTokenPairsTool,
];

const jupiterTools: BaseTool[] = [
  searchSolanaTokensTool,
  getSolanaTrendingTokensTool,
  getSolanaRecentTokensTool,
  getSolanaTokenMarketDataTool,
  getSolanaSwapQuoteTool,
  intentSwapSolanaTool,
];

export function solanaMarketTools(
  options: { includeJupiter?: boolean; includeIntents?: boolean } = {
    includeJupiter: true,
    includeIntents: true,
  },
): BaseTool[] {
  if (options.includeJupiter === false) return [...keylessTools];
  const tools = options.includeIntents === false
    ? jupiterTools.filter((tool) => tool !== intentSwapSolanaTool)
    : jupiterTools;
  return [...keylessTools, ...tools];
}
