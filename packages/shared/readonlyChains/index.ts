import { type BaseTool } from "../client.js";
import { btcRpcTools } from "../btc-rpc/index.js";
import {
  getSolBalanceTool, getSolanaAccountInfoTool, getSolanaTokenBalancesTool,
  getSolanaTokenBalanceTool, getSolanaTokenSupplyTool, getSolanaTransactionTool,
  getSolanaTransactionHistoryTool, getSolanaBlockTool, getSolanaNetworkStatusTool,
  getSolanaPriorityFeesTool,
} from "../solana/tools.js";
import { solanaMarketTools } from "../solana/market-tools.js";

/** Explicit collection: no signing, transaction construction, Jupiter or SDK loading. */
export function readOnlyChainTools(): BaseTool[] {
  const bitcoin = btcRpcTools();
  const solana = [getSolBalanceTool, getSolanaAccountInfoTool, getSolanaTokenBalancesTool,
    getSolanaTokenBalanceTool, getSolanaTokenSupplyTool, getSolanaTransactionTool,
    getSolanaTransactionHistoryTool, getSolanaBlockTool, getSolanaNetworkStatusTool,
    getSolanaPriorityFeesTool];
  const market = solanaMarketTools({ includeJupiter: false, includeIntents: false });
  return [...bitcoin, ...solana, ...market].map(tool => ({
    ...tool,
    description: tool.description + (bitcoin.includes(tool)
      ? " Read-only Bitcoin mainnet lookup. Requires an explicit Bitcoin address where applicable; never use an EVM address."
      : " Read-only Solana lookup. Address-specific reads require an explicit Solana public key; never use an EVM address."),
    execute: async (client, args) => {
      const request = tool.parameters.parse(args);
      const network = bitcoin.includes(tool) ? "bitcoin" : "solana";
      // Prevent path/query injection in the older Bitcoin tools' URL interpolation.
      for (const field of ["blockHash", "txid"]) {
        if (network === "bitcoin" && request[field] !== undefined && !/^[a-fA-F0-9]{64}$/.test(request[field])) {
          throw new Error(`Invalid Bitcoin ${field}: supply exactly 64 hexadecimal characters.`);
        }
      }
      if (network === "bitcoin" && request.address !== undefined &&
          !/^(?:[13][1-9A-HJ-NP-Za-km-z]{25,34}|bc1[ac-hj-np-z02-9]{11,71})$/.test(request.address)) {
        throw new Error("Supply a Bitcoin mainnet address. Testnet and EVM addresses are not supported here.");
      }
      if (solana.includes(tool)) request.cluster ??= "mainnet-beta";
      const result = await tool.execute(client, request);
      return { schemaVersion: 1, tool: tool.name, network,
        cluster: network === "bitcoin" ? "mainnet" : market.includes(tool) ? "mainnet-beta" : request.cluster ?? "mainnet-beta",
        request, observedAt: new Date().toISOString(), result };
    },
  }));
}
