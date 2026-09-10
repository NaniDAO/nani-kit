import { z } from 'zod';
import { createTool } from '../client.js';
import { SUPPORTED_CHAINS } from './constants.js';
import { chainIdMap, getChainName, getProjectFilter } from './utils/helpers.js';
import { fetchDefiLlamaPools, fetchPoolHistoricalData } from './utils/api.js';

const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const percent = (v: unknown) => finite(v) === null ? null : `${(v as number).toFixed(2)}%`;
const canonical = (name: string) => name.trim().toLowerCase() === 'robinhood' ? 'robinhood chain' : name.trim().toLowerCase();
const chains = z.object({ chainId: z.number().int().positive().optional(), chain: z.string().min(1).optional() });
function scope(args: { chainId?: number; chain?: string }) {
  if (args.chainId !== undefined && !SUPPORTED_CHAINS.some(c => c.id === args.chainId)) throw new Error(`Yield discovery has no configured chain mapping for ${args.chainId}`);
  if (args.chain && args.chainId !== undefined && canonical(args.chain) !== canonical(getChainName(args.chainId))) throw new Error('Conflicting chain name and chain ID; no network substituted');
  return args.chainId === undefined ? args.chain && canonical(args.chain) : canonical(getChainName(args.chainId));
}
const schema = chains.extend({
  project: z.string().optional(), protocol: z.enum(['Aave','Compound','Morpho','SparkLend','Lido','RocketPool','DefiLlama']).optional(),
  asset: z.string().optional(), symbol: z.string().optional(), stablecoin: z.boolean().optional(),
  minApy: z.number().finite().nonnegative().optional(), minTvl: z.number().finite().nonnegative().optional(),
  maxRisk: z.enum(['low','medium','high']).optional().describe('Legacy APY screen only; never a protocol safety rating'),
  sortBy: z.enum(['tvl','apy']).default('tvl'), limit: z.number().int().min(1).max(100).default(20),
});
function normalize(pool: any) {
  const apy = finite(pool.apy), tvl = finite(pool.tvlUsd), reward = finite(pool.apyReward);
  const warnings: string[] = ['Protocol deployment, pool contract, withdrawal access and token identity are unverified.'];
  if (apy === null) warnings.push('APY unavailable.');
  if (tvl === null) warnings.push('Liquidity unavailable.');
  else if (tvl < 1_000_000) warnings.push('Low reported liquidity.');
  if (apy !== null && apy > 25) warnings.push('High annualized rate may be temporary.');
  if (reward !== null && reward > 0) warnings.push('Part of the rate depends on incentives; reward price and duration are unverified.');
  if (pool.ilRisk !== 'no') warnings.push('Impermanent loss risk is present or unknown.');
  return {
    project: pool.project, asset: pool.symbol, chain: pool.chain, chainId: chainIdMap[pool.chain] ?? null, pool: pool.pool,
    apy: percent(apy), apyPercent: apy, apyBase: percent(pool.apyBase), apyReward: percent(reward),
    tvl: tvl === null ? null : `$${tvl.toFixed(2)}`, tvlUsd: tvl,
    risk: 'unverified', warnings, stablecoin: typeof pool.stablecoin === 'boolean' ? pool.stablecoin : null,
    ilRisk: pool.ilRisk ?? null, exposure: pool.exposure ?? null,
    underlyingTokens: Array.isArray(pool.underlyingTokens) ? pool.underlyingTokens.filter((t: unknown) => typeof t === 'string') : null,
    contractsVerified: false, poolContract: null, sourceUpdatedAt: null,
    execution: { deposit: 'unverified', withdrawal: 'unverified', reason: 'A data listing is not a verified protocol integration. Verify exact contracts and a supported adapter before proposing.' },
    trend: { '1d': percent(pool.apyPct1D), '7d': percent(pool.apyPct7D), '30d': percent(pool.apyPct30D) },
    prediction: pool.predictions ? { class: pool.predictions.predictedClass ?? null, confidence: percent(pool.predictions.predictedProbability) } : null,
  };
}
export const getYieldTool = createTool({
  name: 'getYieldTool', supportedChains: SUPPORTED_CHAINS,
  description: 'Discover yield candidates on the exact requested network. Default order is liquidity, not a recommendation. Rates are variable; contracts and execution remain unverified. Use history before ranking best opportunities.',
  parameters: schema,
  execute: async (_client, args) => {
    const requested = scope(args);
    const response = await fetchDefiLlamaPools();
    if (!Array.isArray(response.data)) throw new Error('Yield source returned malformed data');
    let rows = response.data.filter(p => typeof p.chain === 'string' && typeof p.project === 'string' && typeof p.symbol === 'string' && typeof p.pool === 'string');
    if (requested) rows = rows.filter(p => canonical(p.chain) === requested);
    const project = args.project ?? (args.protocol && args.protocol !== 'DefiLlama' ? getProjectFilter(args.protocol) : null);
    if (project) rows = rows.filter(p => p.project.toLowerCase().includes(project.toLowerCase()));
    const asset = args.asset ?? args.symbol;
    if (asset) rows = rows.filter(p => p.symbol.toLowerCase().split('-').includes(asset.toLowerCase()));
    if (args.stablecoin !== undefined) rows = rows.filter(p => p.stablecoin === args.stablecoin);
    if (args.minApy !== undefined) rows = rows.filter(p => finite(p.apy) !== null && p.apy! >= args.minApy!);
    if (args.minTvl !== undefined) rows = rows.filter(p => finite(p.tvlUsd) !== null && p.tvlUsd >= args.minTvl!);
    if (args.maxRisk && args.maxRisk !== 'high') rows = rows.filter(p => finite(p.apy) !== null && p.apy! <= (args.maxRisk === 'low' ? 4 : 10));
    rows.sort((a,b) => (finite(args.sortBy === 'apy' ? b.apy : b.tvlUsd) ?? -Infinity) - (finite(args.sortBy === 'apy' ? a.apy : a.tvlUsd) ?? -Infinity));
    return { schemaVersion: 1, source: 'https://yields.llama.fi/pools', observedAt: new Date().toISOString(), sourceUpdatedAt: null,
      requestedChainId: args.chainId ?? null, requestedChain: requested ?? null, ranking: args.sortBy === 'apy' ? 'Reported APY descending; not risk-adjusted' : 'Reported liquidity descending; not a safety rating',
      coverage: 'Source listings only; no onchain deployment or liquidity verification', historyChecked: false,
      totalMatches: rows.length, count: Math.min(rows.length, args.limit), yields: rows.slice(0,args.limit).map(normalize) };
  },
});
async function history(poolId: string, days: number, chainId?: number) {
  scope({chainId});
  const pools = await fetchDefiLlamaPools();
  const pool = pools.data.find(p => p.pool === poolId);
  if (!pool || (chainId !== undefined && chainIdMap[pool.chain] !== chainId)) throw new Error('Pool identity or requested network could not be verified in source listings');
  const response = await fetchPoolHistoricalData(poolId);
  const now = Date.now(), cutoff = now - days * 86400000;
  const points = response.data.filter(p => Number.isFinite(Date.parse(p.timestamp)) && Date.parse(p.timestamp) >= cutoff && Date.parse(p.timestamp) <= now)
    .sort((a,b) => Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const valid = points.map(p => finite(p.apy)).filter((v): v is number => v !== null);
  if (!valid.length) throw new Error('No usable APY observations in requested period');
  const average = valid.reduce((s,v)=>s+v,0)/valid.length;
  return { schemaVersion: 1, source: `https://yields.llama.fi/chart/${encodeURIComponent(poolId)}`, observedAt: new Date().toISOString(),
    poolId, chainId: chainIdMap[pool.chain] ?? null, chain: pool.chain, project: pool.project, asset: pool.symbol,
    requestedDays: days, dataPoints: valid.length, missingApyPoints: points.length-valid.length,
    firstObservation: points[0].timestamp, lastObservation: points[points.length-1].timestamp,
    averageApy: average, minApy: Math.min(...valid), maxApy: Math.max(...valid),
    volatility: valid.length < 2 ? null : Math.sqrt(valid.reduce((s,v)=>s+(v-average)**2,0)/valid.length),
    warnings: ['Historical observations are not a forecast; fees, reward prices and exit costs are not included.', ...(valid.length < 2 ? ['Too few observations to estimate volatility.'] : [])],
    timeline: points.map(p=>({timestamp:p.timestamp,apy:finite(p.apy),apyBase:finite(p.apyBase),apyReward:finite(p.apyReward),tvlUsd:finite(p.tvlUsd)})) };
}
export const getYieldHistoryTool = createTool({name:'getYieldHistoryTool', supportedChains:SUPPORTED_CHAINS,
  description:'Read dated yield history and volatility for a pool; verifies source-listed network when chainId is supplied.',
  parameters:z.object({poolId:z.string().regex(/^[a-zA-Z0-9-]{1,128}$/),chainId:z.number().int().positive().optional(),days:z.number().int().min(1).max(365).default(30)}),
  execute:async(_client,args)=>history(args.poolId,args.days,args.chainId)});
export const compareYieldHistoryTool = createTool({name:'compareYieldHistoryTool',supportedChains:SUPPORTED_CHAINS,
  description:'Compare 2–5 yield histories; preserve failed pools and partial evidence. Volatility is not a safety rating.',
  parameters:z.object({poolIds:z.array(z.string().regex(/^[a-zA-Z0-9-]{1,128}$/)).min(2).max(5),chainId:z.number().int().positive().optional(),days:z.number().int().min(1).max(365).default(30),sortBy:z.enum(['apy','volatility','stability','tvl']).default('volatility')}),
  execute:async(_client,args)=> {
    scope(args);
    const settled=await Promise.allSettled(args.poolIds.map(id=>history(id,args.days,args.chainId)));
    const results=settled.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
    results.sort((a,b)=>args.sortBy==='apy'?b.averageApy-a.averageApy:args.sortBy==='tvl'?(b.timeline.at(-1)?.tvlUsd??-1)-(a.timeline.at(-1)?.tvlUsd??-1):(a.volatility ?? Infinity)-(b.volatility ?? Infinity));
    return {schemaVersion:1,observedAt:new Date().toISOString(),ranking:args.sortBy,results,errors:settled.flatMap((r,i)=>r.status==='rejected'?[{poolId:args.poolIds[i],error:String(r.reason)}]:[]),complete:results.length===args.poolIds.length};
  }});
export const compareYieldTool = createTool({name:'compareYieldTool',supportedChains:SUPPORTED_CHAINS,
  description:'Compare source-listed yields for assets on an explicit network. Ranking by liquidity; gross projections exclude fees and assume unchanged rates.',
  parameters:chains.extend({assets:z.array(z.string().min(1)).min(1).max(5),amount:z.number().finite().positive().optional(),duration:z.number().int().min(1).max(365).optional()}),
  execute:async(client,args)=> {
    scope(args);
    const comparisons=[];
    for(const asset of args.assets) {
      const result=await getYieldTool.execute(client,schema.parse({...args,asset,limit:5}));
      comparisons.push({asset,...result,yields:result.yields.map(p=>({...p,grossProjectedEarnings:args.amount && args.duration && p.apyPercent !== null && p.apyPercent > -100 ? args.amount*((1+p.apyPercent/100)**(args.duration/365)-1):null}))});
    }
    return {schemaVersion:1,comparisons,warning:'No net return estimate: bridge fees, gas, entry/exit costs and future rates are unknown.'};
  }});

export const getYieldPoolEvidence = createTool({
  name:'getYieldPoolEvidence',supportedChains:SUPPORTED_CHAINS,
  description:'Check the exact yield pool listing and bounded underlying-token code at a fixed block on the requested chain. Identifies the actual project; does not verify pool contracts, token legitimacy or deposit/withdrawal support.',
  parameters:z.object({chainId:z.number().int().positive(),poolId:z.string().regex(/^[a-zA-Z0-9-]{1,128}$/)}),
  execute:async(client,args)=> {
    scope(args);
    const source=await fetchDefiLlamaPools();
    const pool:any=source.data.find(p=>p.pool===args.poolId && chainIdMap[p.chain]===args.chainId);
    if(!pool)throw new Error('Requested pool and network not found in source listings');
    const rpc=client.getPublicClient(args.chainId);
    const block=await rpc.getBlock({blockTag:'latest'});
    if(block.number===null || !block.hash)throw new Error('No fixed-block evidence available');
    const tokens=Array.isArray(pool.underlyingTokens)?pool.underlyingTokens:[];
    const checks=await Promise.all(tokens.slice(0,8).map(async(token:unknown)=> {
      if(typeof token!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(token))return {token:typeof token==='string'?token:null,codePresent:null,error:'Invalid source token address'};
      try {const code=await rpc.getBytecode({address:token as `0x${string}`,blockNumber:block.number});return {token,codePresent:!!code && code!=='0x',error:null};}
      catch {return {token,codePresent:null,error:'Token code read failed'};}
    }));
    const after=await rpc.getBlock({blockNumber:block.number});
    if(after.hash!==block.hash)throw new Error('Block changed during token verification; evidence discarded');
    return {schemaVersion:1,source:'https://yields.llama.fi/pools',observedAt:new Date().toISOString(),chainId:args.chainId,poolId:args.poolId,
      project:pool.project,asset:pool.symbol,block:block.number.toString(),blockHash:block.hash,tokenChecks:checks,
      uncheckedTokens:Math.max(0,tokens.length-8),complete:tokens.length>0 && tokens.length<=8 && checks.every(c=>c.codePresent!==null),
      poolContract:null,poolContractVerified:false,deposit:'unverified',withdrawal:'unverified',
      warning:'Code presence does not establish token legitimacy, pool deployment, access rights, withdrawal liquidity or safety. No verified execution adapter is established by this evidence.'};
  },
});
