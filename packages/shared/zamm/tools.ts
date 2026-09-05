import { z } from "zod";
import { createTool } from "../client.js";
import { zammFetch, zammGraphql } from "./constants.js";
import { formatEther } from "viem";
import { addressSchema } from "../utils.js";

// [✓] getCoin
export const getCoin = createTool({
  name: "getCoin",
  description:
    "Fetch metadata about a ZAMM coin by its ticker symbol, including name, total supply, image, and pool information.",
  parameters: z.object({
    symbol: z.string().describe("The coin ticker symbol (e.g. 'PEPE', 'DOGE'). Case-insensitive."),
  }),
  execute: async (_client, args) => {
    // fetch coin by symbol (case-insensitive match)
    const json = await zammFetch(
      `/api/resolve?ticker=${encodeURIComponent(args.symbol)}`,
    );
    const data = json?.data;
    if (!data) throw new Error(`No ZAMM coin found for ticker "${args.symbol}"`);

    return {
      ...data,
      total_supply: formatEther(BigInt(data.total_supply)),
      pools: data.pools.map((pool) => ({
        ...pool,
        reserve0: formatEther(BigInt(pool.reserve0)),
        reserve1: formatEther(BigInt(pool.reserve1)),
        price0: formatEther(BigInt(pool.price0)),
        price1: formatEther(BigInt(pool.price1)),
        otherToken: {
          id: pool.otherToken.id == null ? "0" : pool.otherToken.id,
          symbol: pool.otherToken.symbol == null ? "ETH" : pool.otherToken.symbol,
        }
      })),
    };
  },
});


// getHolders
export const getHolders = createTool({
  name: "getHolders",
  description:
    "Fetch the list of holders for a given ZAMM coin, ordered by balance descending.",
  parameters: z.object({
    coinId: z.string().describe("The numeric coin ID as a decimal string (get this from getCoin)"),
    limit: z.number().int().min(1).max(100).default(50).describe("Number of holders to return (1-100, default 50)"),
    offset: z.number().int().min(0).default(0).describe("Offset for pagination (default 0)"),
  }),
  execute: async (_client, args) => {
    // fetch holders from 'holder' where coinId = args.coinId
    const params = new URLSearchParams({
      coinId: args.coinId,
      limit: args.limit.toString(),
      offset: args.offset.toString(),
    });
    const json = await zammFetch(`/api/holders?${params}`);
    return json?.data ?? [];
  },
});


// getAccountPortfolio
export const getAccountPortfolio = createTool({
  name: "getAccountPortfolio",
  description:
    "Given a wallet address, return all token balances the account holds, including coin metadata.",
  parameters: z.object({
    address: addressSchema,
  }),
  execute: async (_client, args) => {
    // fetch all holders where address = args.address and join coin
    // fetch holders from 'holder' where coinId = args.coinId
    const params = new URLSearchParams({
      address: args.address,
    });
    return await zammFetch(`/api/portfolio?${params}`);
  },
});

// getPool
export const getPool = createTool({
  name: "getPool",
  description:
    "Fetch the latest state of a ZAMM liquidity pool, including reserves, prices, swap fee, and token metadata.",
  parameters: z.object({
    poolId: z.string().describe("The numeric pool ID as a decimal string"),
  }),
  execute: async (_client, args) => {
    const query = `
      query GetPool {
        pool(id: "${args.poolId}") {
          id
          reserve0
          reserve1
          price0
          price1
          swapFee
          coin0 {
            id
            symbol
            name
            image
          }
          coin1 {
            id
            symbol
            name
            image
          }
        }
      }
    `;

    const data = await zammGraphql(query);

    const pool = data?.pool;
    if (!pool) throw new Error(`ZAMM pool ${args.poolId} not found`);

    // Flatten the response
    return {
      id: pool.id,
      reserve0: formatEther(BigInt(pool.reserve0)),
      reserve1: formatEther(BigInt(pool.reserve1)),
      price0: formatEther(BigInt(pool.price0)),
      price1: formatEther(BigInt(pool.price1)),
      swapFee: pool.swapFee,
      coin0Id: pool.coin0.id,
      coin0Symbol: pool.coin0.symbol,
      coin0Name: pool.coin0.name,
      coin0Image: pool.coin0.image,
      coin1Id: pool.coin1.id,
      coin1Symbol: pool.coin1.symbol,
      coin1Name: pool.coin1.name,
      coin1Image: pool.coin1.image,
    };
  },
});


// getSwaps
export const getSwaps = createTool({
  name: "getSwaps",
  description:
    "Fetch recent swap events for a given ZAMM pool, optionally filtered by block range.",
  parameters: z.object({
    poolId: z.string().describe("The numeric pool ID as a decimal string"),
    startBlock: z.string().optional().describe("Optional start block number to filter from (inclusive)"),
    endBlock: z.string().optional().describe("Optional end block number to filter to (inclusive)"),
    limit: z.number().int().min(1).max(1000).default(50).describe("Number of swap events to return (1-1000, default 50)"),
  }),
  execute: async (_client, args) => {
    // Build the where clause conditionally
    let whereClause = `poolId: "${args.poolId}"`;
    if (args.startBlock) {
      whereClause += `, blockNumber_gte: "${args.startBlock}"`;
    }
    if (args.endBlock) {
      whereClause += `, blockNumber_lte: "${args.endBlock}"`;
    }

    const whereArgument = whereClause ? `, where: {${whereClause}}` : '';

    const query = `
      query GetSwaps {
        swaps(limit: ${args.limit}${whereArgument}) {
          items {
            amount0In
            amount0Out
            amount1Out
            amount1In
            blockNumber
            id
            poolId
            source
            timestamp
            toAddr
            trader
            txHash
            pool {
              swapFee
              coin1 {
                symbol
              }
              coin0 {
                symbol
              }
            }
          }
        }
      }
    `;

    const data = await zammGraphql(query);

    // Transform the data to flatten coin symbol information
    const swaps = (data?.swaps?.items ?? []).map((swap: any) => ({
      ...swap,
      coin0Symbol: swap.pool.coin0.symbol,
      coin1Symbol: swap.pool.coin1.symbol,
      swapFee: swap.pool.swapFee,
      pool: undefined, // Remove the nested pool object
    }));

    return swaps;
  },
});
