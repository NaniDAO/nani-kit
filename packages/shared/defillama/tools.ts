import { z } from 'zod';
import { createTool } from '../client.js';
import { assertOkResponse } from '../utils/fetch.js';
import {
  SUPPORTED_YIELD_PROTOCOLS,
  SUPPORTED_CHAINS,
  PoolComparisonResult
} from './constants.js';
import {
  formatUSD,
  getChainName,
  calculateProjectedEarnings,
  fetchProtocolData,
  fetchDefiLlamaPools,
  fetchPoolHistoricalData,
  assessRisk,
  calculateApyStats,
  calculateTvlStats,
  extractTimeSeriesData,
  calculateStabilityScore
} from './utils/index.js';

interface ChartDataPoint {
  timestamp: number
  price: number
}

interface TokenPriceData {
  symbol: string
  confidence: number
  prices: ChartDataPoint[]
}

interface TokenChartResult {
  success: boolean
  tokens: string[]
  period: string
  coins: Record<string, TokenPriceData>
}

// Schema for getTokenChartTool parameters
const getTokenChartToolSchema = z.object({
  tokens: z
    .union([z.string(), z.array(z.string())])
    .describe('Token identifier in format "chain:address" (e.g., "ethereum:0x...", "coingecko:ethereum") or array of such identifiers'),
  period: z
    .string()
    .optional()
    .default('1d')
    .describe('Time interval between data points. Format: 1h, 4h, 1d, 1w (defaults to "1d")'),
  startTime: z
    .string()
    .optional()
    .describe('ISO timestamp for the start time (e.g., "2025-01-01T00:00:00Z")'),
  options: z
    .object({
      span: z.number()
      .default(10)
      .describe('Number of data points to return. Defaults to 10. To create a chart you need many data points.'),
      searchWidth: z
        .string()
        .optional()
        .describe('Time range on either side to find price data (e.g., "600" for 10 minutes)')
    })
    .optional()
    .describe('Optional configuration for the chart data')
});

// Token chart tool
export const getTokenChartTool = createTool({
  name: 'getTokenChart',
  description: 'Gets historical price chart data for one or more tokens from DeFi Llama',
  parameters: getTokenChartToolSchema,
  execute: async (_client, args): Promise<TokenChartResult> => {
    const { tokens, period, startTime, options } = args;

    try {
      const unixStartTime = startTime ? Math.floor(new Date(startTime).getTime() / 1000) : undefined;

      // Handle single token or array of tokens
      const tickerString = Array.isArray(tokens) ? tokens.join(',') : tokens;

      const baseUrl = 'https://coins.llama.fi';
      const url = new URL(`${baseUrl}/chart/${tickerString}`);

      // Only add parameters that are defined
      const params: Record<string, string> = {
        period
      };

      // Only add start time if it exists
      if (unixStartTime !== undefined) {
        params.start = unixStartTime.toString();
      }

      // Add optional parameters if they exist
      if (options?.span) {
        params.span = options.span.toString();
      } else {
        params.span = '10';
      }

      if (options?.searchWidth) {
        params.searchWidth = options.searchWidth;
      }

      url.search = new URLSearchParams(params).toString();

      const response = await fetch(url.toString());

      await assertOkResponse(response, `Failed to fetch chart data from ${url.toString()}`);

      const data = await response.json();

      return {
        success: true,
        tokens: Array.isArray(tokens) ? tokens : [tokens],
        period,
        coins: data.coins
      };

    } catch (error) {
      throw new Error(`Failed to fetch token chart data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
});

// Schema for defiLlamaYieldTool parameters
export { getYieldTool, compareYieldTool, getYieldHistoryTool, compareYieldHistoryTool } from './research.js';
