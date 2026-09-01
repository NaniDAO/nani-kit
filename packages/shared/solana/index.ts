import { BaseTool, createToolCollection } from "../client.js";
import {
  getSolBalanceTool,
  getSolanaAccountInfoTool,
  getSolanaBlockTool,
  getSolanaNetworkStatusTool,
  getSolanaPriorityFeesTool,
  getSolanaTokenBalanceTool,
  getSolanaTokenBalancesTool,
  getSolanaTokenSupplyTool,
  getSolanaTransactionHistoryTool,
  getSolanaTransactionTool,
} from "./tools.js";
import {
  intentTransferSolTool,
  intentTransferSplTokenTool,
} from "./intents.js";
import { solanaMarketTools } from "./market-tools.js";

export function solanaTools(
  options: { includeJupiter?: boolean; includeIntents?: boolean } = {},
): BaseTool[] {
  const reads = [
    getSolBalanceTool,
    getSolanaAccountInfoTool,
    getSolanaTokenBalancesTool,
    getSolanaTokenBalanceTool,
    getSolanaTokenSupplyTool,
    getSolanaTransactionTool,
    getSolanaTransactionHistoryTool,
    getSolanaBlockTool,
    getSolanaNetworkStatusTool,
    getSolanaPriorityFeesTool,
  ];

  // includeIntents: false drops every tool that can move funds, so a read-only
  // deployment can register the collection without the write surface.
  const intents =
    options.includeIntents === false
      ? []
      : [intentTransferSolTool, intentTransferSplTokenTool];

  return createToolCollection([
    ...reads,
    ...intents,
    ...solanaMarketTools(options),
  ]);
}

export * from "./constants.js";
export { decodeBase58, encodeBase58 } from "./base58.js";
export { solanaRpc } from "./rpc.js";
export {
  DEXSCREENER_API_BASE_URL,
  JUPITER_API_BASE_URL,
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
export { solanaMarketTools } from "./market-tools.js";
export {
  formatLamports,
  resolveSolanaMint,
  solanaAddressSchema,
  solanaSignatureSchema,
} from "./utils.js";
