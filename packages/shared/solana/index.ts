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

export function solanaTools(): BaseTool[] {
  return createToolCollection([
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
    intentTransferSolTool,
    intentTransferSplTokenTool,
  ]);
}

export * from "./constants.js";
export { decodeBase58, encodeBase58 } from "./base58.js";
export { solanaRpc } from "./rpc.js";
export {
  formatLamports,
  resolveSolanaMint,
  solanaAddressSchema,
  solanaSignatureSchema,
} from "./utils.js";
