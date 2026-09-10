import { Chain } from 'viem/chains';
import { RISK_THRESHOLDS, RiskLevel } from '../constants.js';

// Helper function to format USD values
export function formatUSD(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Risk assessment function
export function assessRisk(apy: number): RiskLevel {
  if (apy > RISK_THRESHOLDS.medium) return 'high';
  if (apy > RISK_THRESHOLDS.low) return 'medium';
  return 'low';
}

// Helper function to get chain name
export function getChainName(chainId: number): string {
  const chainMap: Record<number, string> = {
    1: 'Ethereum',
    4663: 'Robinhood Chain',
    10: 'Optimism',
    137: 'Polygon',
    42161: 'Arbitrum',
    8453: 'Base',
    43114: 'Avalanche',
    56: 'BSC',
    250: 'Fantom',
    100: 'Gnosis',
    1399811149: 'Solana',
    1101: 'Polygon zkEVM',
    324: 'zkSync Era',
  };
  
  return chainMap[chainId] || `Chain ${chainId}`;
}

// Helper function to calculate projected earnings
export function calculateProjectedEarnings(amount: number, apy: number, days: number): number {
  // Convert APY to daily rate
  const dailyRate = (1 + apy / 100) ** (1 / 365) - 1;
  // Compound interest formula
  return amount * ((1 + dailyRate) ** days - 1);
}

// Chain ID mapping for DefiLlama
export const chainIdMap: Record<string, number> = {
  'Ethereum': 1,
  'Robinhood Chain': 4663,
  'Robinhood': 4663,
  'Optimism': 10,
  'Polygon': 137,
  'Arbitrum': 42161,
  'Base': 8453,
  'Avalanche': 43114,
  'BSC': 56,
  'Fantom': 250,
  'Gnosis': 100,
  'Solana': 1399811149,
  'Polygon zkEVM': 1101,
  'zkSync Era': 324,
};

// Get protocol project filter for DefiLlama
export function getProjectFilter(protocol: string): string | null {
  const projectMap: Record<string, string> = {
    'Aave': 'aave',
    'Compound': 'compound',
    'Morpho': 'morpho',
    'SparkLend': 'spark',
    'Lido': 'lido',
    'RocketPool': 'rocket-pool',
  };
  
  return projectMap[protocol] || null;
}