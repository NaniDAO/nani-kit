import { 
  PROTOCOL_API_ENDPOINTS, 
  DefiLlamaResponse, 
  DefiLlamaChartResponse,
  YieldProtocol,
  YieldData
} from '../constants.js';
import { assessRisk, chainIdMap, getProjectFilter } from './helpers.js';
import { assertOkResponse } from '../../utils/fetch.js';

// Fetch pool data from DefiLlama
export async function fetchDefiLlamaPools(): Promise<DefiLlamaResponse> {
  const response = await fetch(PROTOCOL_API_ENDPOINTS.DefiLlama);
  await assertOkResponse(response, "Failed to fetch from DefiLlama");

  return await response.json();
}

// Fetch historical chart data for a specific pool
export async function fetchPoolHistoricalData(poolId: string): Promise<DefiLlamaChartResponse> {
  const apiUrl = `${PROTOCOL_API_ENDPOINTS.DefiLlamaChart}/${poolId}`;
  
  const response = await fetch(apiUrl);
  await assertOkResponse(response, "Failed to fetch from DefiLlama");

  const data: DefiLlamaChartResponse = await response.json();
  
  if (!data.data || data.data.length === 0) {
    throw new Error(`No historical data found for pool ID: ${poolId}`);
  }
  
  return data;
}

// Normalized fetching logic for different protocols
export async function fetchProtocolData(protocol: YieldProtocol, chainId?: number): Promise<YieldData[]> {
  try {
    // Fetch data from DefiLlama yields API
    const data = await fetchDefiLlamaPools();
    
    // Filter by project if specific protocol is requested (except DefiLlama)
    let filteredData = data.data;
    if (protocol !== 'DefiLlama') {
      const projectFilter = getProjectFilter(protocol);
      if (projectFilter) {
        filteredData = filteredData.filter(pool => 
          pool.project.toLowerCase().includes(projectFilter.toLowerCase())
        );
      }
    }
    
    // Filter by chain ID if specified
    if (chainId) {
      filteredData = filteredData.filter(pool => {
        const poolChainId = chainIdMap[pool.chain];
        return poolChainId === chainId;
      });
    }
    
    // Map to YieldData format
    return filteredData.map(pool => {
      // Get apy value, using base APY if total APY is null
      const apyValue = pool.apy !== null ? pool.apy : 
                      (pool.apyBase !== null ? pool.apyBase : 0);
      
      return {
        protocol: protocol as YieldProtocol,
        asset: pool.project,
        symbol: pool.symbol,
        apy: apyValue,
        tvl: pool.tvlUsd,
        chain: chainIdMap[pool.chain] ?? 0, // Unknown identity must never become Ethereum
        risk: assessRisk(apyValue),
      };
    });
  } catch (error) {
    throw error;
  }
}