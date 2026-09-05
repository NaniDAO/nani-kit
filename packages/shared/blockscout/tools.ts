import { z } from "zod";
import { createTool } from "../client.js";
import { mainnet, polygon, arbitrum, optimism, base } from "viem/chains";
import { formatEther } from "viem";
import { addressSchema } from "../utils.js";

const supportedChains = [mainnet, polygon, arbitrum, optimism, base];
const chainSchema = z
  .union([
    z.enum([
      String(mainnet.id),
      String(polygon.id),
      String(arbitrum.id),
      String(optimism.id),
      String(base.id),
    ]),
    z.number().transform(String).pipe(
      z.enum([
        String(mainnet.id),
        String(polygon.id),
        String(arbitrum.id),
        String(optimism.id),
        String(base.id),
      ])
    )
  ])
  .transform(Number)
  .describe("Chain ID for the blockchain network. Supports: 1, 137, 42161, 10, and 8453") as unknown as z.ZodNumber;

// Note: the endpoints already include "/api/v2"
const BLOCKSCOUT_API_ENDPOINTS = new Map([
  [mainnet.id, "https://eth.blockscout.com/api/v2"],
  [polygon.id, "https://polygon.blockscout.com/api/v2"],
  [arbitrum.id, "https://arbitrum.blockscout.com/api/v2"],
  [optimism.id, "https://optimism.blockscout.com/api/v2"],
  [base.id, "https://base.blockscout.com/api/v2"],
]);

type SupportedChain = (typeof supportedChains)[number]["id"];

/** Blockscout can stall indefinitely on busy addresses; bound every call. */
const BLOCKSCOUT_TIMEOUT_MS = 30_000;

/** Default page size for list endpoints. Blockscout itself returns ~50. */
export const DEFAULT_ITEM_LIMIT = 10;

/**
 * Longest string kept inside a list item.
 *
 * Capping the item count alone wasn't enough: a single Blockscout transaction
 * carries `raw_input` and decoded call data that can run to tens of kilobytes,
 * so ten of them still came to ~65k tokens. Long values are cut with a marker
 * that says how much was dropped, which keeps the item readable and lets the
 * caller go to getTransactionInfo for the full record.
 */
const MAX_FIELD_CHARS = 512;

function trimLongStrings(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return value.length > MAX_FIELD_CHARS
      ? `${value.slice(0, MAX_FIELD_CHARS)}…[truncated, ${value.length} chars total]`
      : value;
  }
  if (depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => trimLongStrings(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, trimLongStrings(v, depth + 1)]),
    );
  }
  return value;
}

/** Shared `limit` parameter for the list-returning tools. */
export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe(
    `Maximum number of items to return (1-100, default ${DEFAULT_ITEM_LIMIT}). Raise it only when you need more; a full page of transactions can run to hundreds of kilobytes.`,
  );

/**
 * Helper to call a Blockscout v2 endpoint.
 * The endpoint parameter should be the "path" (starting with a slash) after the base URL.
 * An optional query object is appended as query parameters, and `options.limit`
 * caps how many items a list response returns.
 */
export async function fetchFromBlockscoutV2(
  chain: SupportedChain,
  endpoint: string,
  query?: Record<string, string>,
  options?: { limit?: number },
) {
  const baseUrl = BLOCKSCOUT_API_ENDPOINTS.get(chain);
  if (!baseUrl) {
    throw new Error(`Chain ${chain} is not supported.`);
  }
  let url = `${baseUrl}${endpoint}`;
  if (query && Object.keys(query).length > 0) {
    const queryParams = new URLSearchParams(query);
    url += `?${queryParams.toString()}`;
  }
  try {
    // Without a signal, a Blockscout endpoint that never answers — which
    // /internal-transactions and /withdrawals do for high-activity addresses —
    // hangs the caller forever rather than failing.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(BLOCKSCOUT_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();

    // List endpoints return every item Blockscout has for the page — over half
    // a megabyte for an active address, which is more than the context window
    // this is being called into. Cap it, and say what was left behind.
    if (json && Array.isArray(json.items)) {
      const limit = options?.limit ?? DEFAULT_ITEM_LIMIT;
      const total = json.items.length;
      const items = json.items.slice(0, limit).map((item: unknown) =>
        trimLongStrings(item),
      );
      if (total > limit) {
        return {
          ...json,
          items,
          items_returned: limit,
          items_available_on_page: total,
          truncated: true,
          truncation_note: `Showing ${limit} of ${total} items on this page, with long fields shortened. Pass a higher \`limit\` for more, use next_page_params to page, or call the per-transaction tools for a full record.`,
        };
      }
      return { ...json, items, items_returned: total, truncated: false };
    }

    return json;
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.name === "TimeoutError" || error.name === "AbortError") {
        throw new Error(
          `Blockscout request timed out after ${BLOCKSCOUT_TIMEOUT_MS}ms: ${url}`,
        );
      }
      throw new Error(`Failed to fetch from Blockscout: ${error.message}`);
    }
    throw error;
  }
}
/**
 * /addresses ENDPOINTS
 * - GET /addresses => Get native coin holders list
 * - GET /addresses/{address_hash} => Get address info
 * - GET /addresses/{address_hash}/counters => Get address counters
 * - GET /addresses/{address_hash}/transactions => Get address transactions
 * - GET /addresses/{address_hash}/token-transfers => Get address token transfers
 * - GET /addresses/{address_hash}/internal-transactions => Get address internal transactions
 * - GET /addresses/{address_hash}/logs => Get address logs
 * - GET /addresses/{address_hash}/blocks-validated => Get blocks validated by address
 * - GET /addresses/{address_hash}/token-balances => Get all tokens balances for the address
 * - GET /addresses/{address_hash}/tokens => Token balances with filtering and pagination
 * - GET /addresses/{address_hash}/coin-balance-history => Get address coin balance history
 * - GET /addresses/{address_hash}/coin-balance-history-by-day => Get address coin balance history by day
 * - GET /addresses/{address_hash}/withdrawals => Get address withdrawals
 * - GET /addresses/{address_hash}/nft => Get list of NFT owned by address
 * - GET /addresses/{address_hash}/nft/collections => Get list of NFT owned by address, grouped by collection
 */

/**
 * Get native coin holders
 * Get native coin holders list
 * Endpoint: GET /addresses
 */
export const getNativeCoinHolders = createTool({
  name: "getNativeCoinHolders",
  description: "Get the top native coin (ETH/MATIC/etc.) holders on the specified chain, ranked by balance.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get address info
 * Get information about a specific address
 * Endpoint: GET /addresses/{address_hash}
 */
export const getAddressInfo = createTool({
  name: "getAddressInfo",
  description: "Get detailed information about an address including native coin balance (formatted in ETH with USD value), token count, transaction count, and whether it is a contract.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format").describe("The wallet or contract address to look up (0x...)"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    const response = await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses/${address}`,
    );

    let coin_balance = null;
    let coin_balance_in_usd = null;

    if (response.coin_balance !== null) {
      coin_balance = formatEther(BigInt(response.coin_balance));
      if (response.exchange_rate) {
        coin_balance_in_usd = parseFloat(coin_balance) * parseFloat(response.exchange_rate);
      }
    }

    return {
      ...response,
      coin_balance_raw: response.coin_balance,
      coin_balance,
      coin_balance_in_usd,
    };
  },
});

/**
 * Get address counters
 * Get counters for a specific address
 * Endpoint: GET /addresses/{address_hash}/counters
 */
export const getAddressCounters = createTool({
  name: "getAddressCounters",
  description: "Get aggregate counters for an address: total transactions, token transfers, gas usage, and validations count.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: addressSchema,
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, address, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses/${address}/counters`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get address transactions
 * Get transactions for a specific address
 * Endpoint: GET /addresses/{address_hash}/transactions
 */
export const getAddressTransactions = createTool({
  name: "getAddressTransactions",
  description: "Get the list of transactions sent from or received by a specific address.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: addressSchema,
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, address, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses/${address}/transactions`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get token transfers for address
 * Get token transfers for a specific address
 * Endpoint: GET /addresses/{address_hash}/token-transfers
 */
export const getAddressTokenTransfers = createTool({
  name: "getAddressTokenTransfers",
  description: "Get ERC20/ERC721/ERC1155 token transfers involving a specific address.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: addressSchema,
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, address, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses/${address}/token-transfers`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get internal transactions for address
 * Get internal transactions for a specific address
 * Endpoint: GET /addresses/{address_hash}/internal-transactions
 */
export const getAddressInternalTransactions = createTool({
  name: "getAddressInternalTransactions",
  description: "Get internal (trace-level) transactions for an address, including contract-to-contract calls and ETH transfers within transactions.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: addressSchema,
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, address, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses/${address}/internal-transactions`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get logs for address
 * Get logs for a specific address
 * Endpoint: GET /addresses/{address_hash}/logs
 */
export const getAddressLogs = createTool({
  name: "getAddressLogs",
  description: "Get event logs emitted by a specific address (useful for tracking contract events).",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: addressSchema,
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, address, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses/${address}/logs`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get blocks validated by address
 * Get blocks validated by a specific address
 * Endpoint: GET /addresses/{address_hash}/blocks-validated
 */
export const getAddressBlocksValidated = createTool({
  name: "getAddressBlocksValidated",
  description: "Get blocks validated (proposed) by a specific validator address.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: addressSchema,
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, address, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses/${address}/blocks-validated`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get token balances for address
 * Get all token balances for a specific address
 * Endpoint: GET /addresses/{address_hash}/token-balances
 */
export const getAddressTokenBalances = createTool({
  name: "getAddressTokenBalances",
  description: "Get all ERC20/ERC721/ERC1155 token balances held by a specific address, with token metadata.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: addressSchema,
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, address, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses/${address}/token-balances`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get address tokens
 * Get token balances with filtering and pagination
 * Endpoint: GET /addresses/{address_hash}/tokens
 */
export const getAddressTokens = createTool({
  name: "getAddressTokens",
  description: "Get token balances for an address with filtering and pagination support. Returns token metadata alongside balances.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: addressSchema,
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, address, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses/${address}/tokens`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get coin balance history
 * Get address coin balance history
 * Endpoint: GET /addresses/{address_hash}/coin-balance-history
 */
export const getAddressCoinBalanceHistory = createTool({
  name: "getAddressCoinBalanceHistory",
  description: "Get the native coin balance history for an address (every balance change event).",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: addressSchema,
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, address, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses/${address}/coin-balance-history`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get daily coin balance history
 * Get address coin balance history by day
 * Endpoint: GET /addresses/{address_hash}/coin-balance-history-by-day
 */
export const getAddressCoinBalanceHistoryByDay = createTool({
  name: "getAddressCoinBalanceHistoryByDay",
  description: "Get the daily native coin balance snapshots for an address (one data point per day).",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: addressSchema,
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, address, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses/${address}/coin-balance-history-by-day`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get address withdrawals
 * Get withdrawals for a specific address
 * Endpoint: GET /addresses/{address_hash}/withdrawals
 */
export const getAddressWithdrawals = createTool({
  name: "getAddressWithdrawals",
  description: "Get beacon chain withdrawals received by a specific address.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: addressSchema,
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, address, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses/${address}/withdrawals`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get NFTs owned by address
 * Get list of NFTs owned by address
 * Endpoint: GET /addresses/{address_hash}/nft
 */
export const getAddressNFTs = createTool({
  name: "getAddressNFTs",
  description: "Get all NFTs (ERC721/ERC1155) owned by an address.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: addressSchema,
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, address, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses/${address}/nft`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get NFT collections owned by address
 * Get list of NFTs owned by address, grouped by collection
 * Endpoint: GET /addresses/{address_hash}/nft/collections
 */
export const getAddressNFTCollections = createTool({
  name: "getAddressNFTCollections",
  description: "Get NFTs owned by an address, grouped by collection (ERC721/ERC1155).",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: addressSchema,
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, address, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/addresses/${address}/nft/collections`,
      undefined,
      { limit },
    );
  },
});

/**
 * /blocks ENDPOINTS
 * - GET /blocks/{block_number_or_hash} => Get block info
 * - GET /blocks/{block_number_or_hash}/transactions => Get block transactions
 * - GET /blocks/{block_number_or_hash}/withdrawals => Get block withdrawals
 */

/**
 * Get block info
 * Get information about a specific block
 * Endpoint: GET /blocks/{blockNumberOrHash}
 */
export const getBlockInfo = createTool({
  name: "getBlockInfo",
  description: "Get information about a specific block",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    blockNumberOrHash: z.union([z.string(), z.number()]).describe("Block number or block hash to query"),
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, blockNumberOrHash, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/blocks/${blockNumberOrHash}`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get block transactions
 * Get transactions within a specific block
 * Endpoint: GET /blocks/{blockNumberOrHash}/transactions
 */
export const getBlockTransactions = createTool({
  name: "getBlockTransactions",
  description: "Get transactions within a specific block",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    blockNumberOrHash: z.union([z.string(), z.number()]).describe("Block number or block hash to query"),
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, blockNumberOrHash, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/blocks/${blockNumberOrHash}/transactions`,
      undefined,
      { limit },
    );
  },
});

/**
 * Get block withdrawals
 * Get withdrawals within a specific block
 * Endpoint: GET /blocks/{blockNumberOrHash}/withdrawals
 */
export const getBlockWithdrawals = createTool({
  name: "getBlockWithdrawals",
  description: "Get withdrawals within a specific block",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    blockNumberOrHash: z.union([z.string(), z.number()]).describe("Block number or block hash to query"),
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, blockNumberOrHash, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/blocks/${blockNumberOrHash}/withdrawals`,
      undefined,
      { limit },
    );
  },
});

/**
 * /stats ENDPOINTS
 * - GET /stats/counters => Get statistics counters for the chain
 * - GET /stats/charts/market => Get market chart data
 * - GET /stats/charts/transactions => Get daily transactions chart
 */

/**
 * Get statistics counters for the chain
 * Returns statistics counters for various blockchain metrics.
 * Endpoint: GET /stats/counters
 */
export const getStats = createTool({
  name: "getStats",
  description: "Get aggregate blockchain statistics including total blocks, transactions, addresses, and average block time.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
  }),
  execute: async (_, args) => {
    const { chain } = args;
    return await fetchFromBlockscoutV2(chain as SupportedChain, "/stats");
  },
});

/**
 * Get transactions chart data.
 * Returns daily transaction statistics.
 * Endpoint: GET /stats/charts/transactions
 */
export const getTransactionsChart = createTool({
  name: "getTransactionsChart",
  description: "Get daily transaction count chart data for the specified chain. Returns time-series data useful for activity trends.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
  }),
  execute: async (_, args) => {
    const { chain } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      "/stats/charts/transactions",
    );
  },
});

/**
 * /transactions ENDPOINTS
 * - GET /transactions/{txhash} => Get transaction details
 * - GET /transactions/{txhash}/token-transfers => Get token transfers
 * - GET /transactions/{txhash}/internal-transactions => Get internal transactions
 * - GET /transactions/{txhash}/logs => Get transaction logs
 * - GET /transactions/{txhash}/raw-trace => Get raw trace info
 * - GET /transactions/{txhash}/state-changes => Get state changes
 * - GET /transactions/{txhash}/summary => Get transaction summary
 */

/**
 * 13. getTransactionInfo
 * Retrieve detailed info for a given transaction hash.
 * Endpoint: GET /transactions/{txhash}?index=...
 */
export const getTransactionInfo = createTool({
  name: "getTransactionInfo",
  description: "Retrieve detailed information for a given transaction hash.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    txhash: z.string().describe("The transaction hash (0x...)"),
  }),
  execute: async (_, args) => {
    const { chain, txhash } = args;
    const query: Record<string, string> = {};
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/transactions/${txhash}`,
      query,
    );
  },
});

/**
 * 13. getTransactionTokenTransfers
 * Retrieve token transfers for a given transaction hash.
 * Endpoint: GET /transactions/{txhash}/token-transfers
 */
export const getTransactionTokenTransfers = createTool({
  name: "getTransactionTokenTransfers",
  description:
    "Retrieve all token transfers that occurred within a given transaction.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    txhash: z.string().describe("The transaction hash (0x...)"),
  }),
  execute: async (_, args) => {
    const { chain, txhash } = args;
    const query: Record<string, string> = {};
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/transactions/${txhash}/token-transfers`,
      query,
    );
  },
});

/**
 * getTransactionInternalTransactions
 * Retrieve internal transactions for a given transaction hash.
 * Endpoint: GET /transactions/{txhash}/internal-transactions
 */
export const getTransactionInternalTransactions = createTool({
  name: "getTransactionInternalTransactions",
  description:
    "Retrieve internal transactions that occurred within a given transaction.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    txhash: z.string().describe("The transaction hash (0x...)"),
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, txhash, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/transactions/${txhash}/internal-transactions`,
      undefined,
      { limit },
    );
  },
});

/**
 * getTransactionLogs
 * Retrieve logs generated from a transaction.
 * Endpoint: GET /transactions/{txhash}/logs
 */
export const getTransactionLogs = createTool({
  name: "getTransactionLogs",
  description: "Retrieve logs that were generated from a specific transaction.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    txhash: z.string().describe("The transaction hash (0x...)"),
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, txhash, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/transactions/${txhash}/logs`,
      undefined,
      { limit },
    );
  },
});

/**
 * getTransactionRawTrace
 * Retrieve raw trace info for a transaction.
 * Endpoint: GET /transactions/{txhash}/raw-trace
 */
export const getTransactionRawTrace = createTool({
  name: "getTransactionRawTrace",
  description: "Retrieve raw trace information for a specific transaction.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    txhash: z.string().describe("The transaction hash (0x...)"),
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, txhash, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/transactions/${txhash}/raw-trace`,
      undefined,
      { limit },
    );
  },
});

/**
 * getTransactionStateChanges
 * Retrieve state changes made by a specific transaction.
 * Endpoint: GET /transactions/{txhash}/state-changes
 */
export const getTransactionStateChanges = createTool({
  name: "getTransactionStateChanges",
  description: "Retrieve state changes that occurred during a transaction.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    txhash: z.string().describe("The transaction hash (0x...)"),
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, txhash, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/transactions/${txhash}/state-changes`,
      undefined,
      { limit },
    );
  },
});

/**
 * getTransactionSummary
 * Retrieve a summary of a transaction.
 * Endpoint: GET /transactions/{txhash}/summary
 */
export const getTransactionSummary = createTool({
  name: "getTransactionSummary",
  description: "Retrieve a summary of data related to a transaction.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    txhash: z.string().describe("The transaction hash (0x...)"),
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, txhash, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/transactions/${txhash}/summary`,
      undefined,
      { limit },
    );
  },
});

/**
 * /smart-contracts ENDPOINTS
 * - GET /smart-contracts => Get smart contracts
 * - GET /smart-contracts/{address} => Get smart contract info
 */

/**
 * 19. getContracts
 * List contract addresses known to the explorer.
 * Endpoint: GET /smart-contracts
 */
export const getSmartContracts = createTool({
  name: "getSmartContracts",
  description: "Search for verified smart contracts by name, address, or symbol. Optionally filter by programming language.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    q: z.string().describe("Search query — contract name, address, or symbol (e.g. 'USDC', 'Uniswap')"),
    language: z
      .enum(["solidity", "yul", "viper"])
      .optional()
      .describe("Filter by contract language: 'solidity', 'yul', or 'viper'. Omit to include all languages."),
  }),
  execute: async (_, args) => {
    const { chain, q, language } = args;
    const query: Record<string, string> = {};
    query["q"] = q;
    if (language) {
      query["language"] = language;
    }

    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/smart-contracts`,
      query,
    );
  },
});

/**
 * 17. getContractSource
 * Retrieve the source code of a verified contract.
 * Endpoint: GET /contracts/{address}/source-code
 */
export const getSmartContract = createTool({
  name: "getSmartContract",
  description: "Retrieve the source code, ABI, and metadata of a verified smart contract by its address.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid contract address")
      .describe("The smart contract address to look up (0x...)"),
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, address, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/smart-contracts/${address}`,
      undefined,
      { limit },
    );
  },
});

/**
 * /tokens ENDPOINTS
 * - GET /tokens/{token_address} => Get token data and state by provided contract address
 * - GET /tokens/{token_address}/holders => Get token holders
 * - GET /tokens/{token_address}/transfers => Get token transfers by provided contract address
 */

/**
 * 21. getTokenInfo
 * Fetch metadata for a token contract.
 * Endpoint: GET /tokens/{tokenContract}
 */
export const getTokenInfo = createTool({
  name: "getTokenInfo",
  description: "Fetch metadata for a token contract.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    tokenContract: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token contract address")
      .describe("The token contract address (0x...)"),
    limit: limitSchema,
  }),
  execute: async (_, args) => {
    const { chain, tokenContract, limit } = args;
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/tokens/${tokenContract}`,
      undefined,
      { limit },
    );
  },
});

/**
 * 22. getTokenHolders
 * Retrieve token holders and their balances for a token.
 * Endpoint: GET /tokens/{tokenContract}/holders
 */
export const getTokenHolders = createTool({
  name: "getTokenHolders",
  description: "Retrieve token holders and their balances for a given token.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    tokenContract: addressSchema.describe("The token contract address (0x...)"),
    page: z.number().optional().describe("Page number for pagination (starts at 1)"),
    offset: z.number().optional().describe("Number of items per page"),
  }),
  execute: async (_, args) => {
    const { chain, tokenContract, page, offset } = args;
    const query: Record<string, string> = {};
    if (page !== undefined) query["page"] = String(page);
    if (offset !== undefined) query["offset"] = String(offset);

    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/tokens/${tokenContract}/holders`,
      query,
    );
  },
});

/**
 * 23. getTokenTransfers
 * List transfers for a specific token contract.
 * Endpoint: GET /tokens/{tokenContract}/transfers
 */
export const getTokenTransfers = createTool({
  name: "getTokenTransfers",
  description:
    "List transfers for a specific token contract with pagination support.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    tokenContract: addressSchema.describe("The token contract address (0x...)"),
    page: z.number().optional().describe("Page number for pagination (starts at 1)"),
    offset: z.number().optional().describe("Number of items per page"),
  }),
  execute: async (_, args) => {
    const { chain, tokenContract, page, offset } = args;
    const query: Record<string, string> = {};
    if (page !== undefined) query["page"] = String(page);
    if (offset !== undefined) query["offset"] = String(offset);
    return await fetchFromBlockscoutV2(
      chain as SupportedChain,
      `/tokens/${tokenContract}/transfers`,
      query,
    );
  },
});

/**
 * /search ENDPOINTS
 * - GET /search => Get search results
 */
export const getBlockscoutSearch = createTool({
  name: "getBlockscoutSearch",
  description:
    "Perform a search query to find blocks, transactions, addresses, or tokens on the blockchain.",
  supportedChains: supportedChains,
  parameters: z.object({
    chain: chainSchema,
    query: z.string().min(1, "A non-empty search query is required").describe("Search term — address, transaction hash, block number, token name, or symbol"),
  }),
  execute: async (_, args) => {
    const { chain, query } = args;
    // Assuming the Blockscout v2 API exposes a search endpoint at `/search`
    // with the query passed as parameter 'q'. Adjust if your API differs.
    return await fetchFromBlockscoutV2(chain as SupportedChain, `/search`, {
      q: query,
    });
  },
});
