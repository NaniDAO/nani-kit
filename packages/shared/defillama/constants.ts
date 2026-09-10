import { Chain, mainnet, optimism, arbitrum, base, polygon } from 'viem/chains';

import { robinhood } from '../chains/robinhood.js';

export const SUPPORTED_CHAINS: Chain[] = [mainnet, optimism, arbitrum, base, polygon, robinhood];

export const SUPPORTED_YIELD_PROTOCOLS = [
  'Aave',
  'Compound',
  'Morpho',
  'SparkLend',
  'Lido',
  'RocketPool',
  'DefiLlama',
] as const;

export type YieldProtocol = typeof SUPPORTED_YIELD_PROTOCOLS[number];

export type RiskLevel = 'low' | 'medium' | 'high';

export interface YieldData {
  protocol: YieldProtocol;
  asset: string;
  symbol: string;
  apy: number;
  tvl: number;
  chain: number;
  risk: RiskLevel;
}

// DefiLlama pool interface based on their API response
export interface DefiLlamaPool {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apyBase: number | null;
  apyReward: number | null;
  apy: number | null;
  rewardTokens: string[] | null;
  pool: string;
  apyPct1D?: number;
  apyPct7D?: number;
  apyPct30D?: number;
  stablecoin: boolean;
  ilRisk: string;
  exposure: string;
  predictions?: {
    predictedClass: string;
    predictedProbability: number;
    binnedConfidence: number;
  };
}

export interface DefiLlamaResponse {
  status: string;
  data: DefiLlamaPool[];
}

export interface DefiLlamaChartDataPoint {
  timestamp: string;
  tvlUsd: number;
  apy: number;
  apyBase: number | null;
  apyReward: number | null;
  il7d: number | null;
  apyBase7d: number | null;
}

export interface DefiLlamaChartResponse {
  status: string;
  data: DefiLlamaChartDataPoint[];
}

export interface PoolComparisonResult {
  poolId: string;
  project: string;
  symbol: string;
  chain: string;
  current: {
    apy: string;
    tvl: string;
  };
  statistics: {
    apy: {
      average: string;
      min: string;
      max: string;
      volatility: string;
    },
    tvl: {
      average: string;
      min: string;
      max: string;
    }
  };
  performance: {
    apyChange30d?: string;
    apyRank?: number;
    volatilityRank?: number;
    stabilityScore?: number;
  };
}

// API endpoints
export const PROTOCOL_API_ENDPOINTS = {
  DefiLlama: 'https://yields.llama.fi/pools',
  DefiLlamaChart: 'https://yields.llama.fi/chart',
  DefiLlamaCoinsChart: 'https://coins.llama.fi/chart'
};

// Risk assessment configuration thresholds
export const RISK_THRESHOLDS = {
  low: 4,    // 0-4% APY considered low risk
  medium: 10, // 4-10% APY considered medium risk
  high: 100,  // >10% APY considered high risk
};
