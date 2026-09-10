import type { BaseTool } from '../client.js';
import { searchTools } from '../search/index.js';
import { coindeskTools } from '../coindesk/index.js';
import { createCoinMarketCalTools } from '../coinmarketcal/index.js';
import { createTallyProposalsTool, createTallyChainsTool, createTallyUserDaosTool } from '../tally/tools.js';
import { createSearchRecentTweetsTool, createGetTweetByIdTool, createGetUserByUsernameTool, createGetUserTweetsTool, createGetHomeTimelineTool } from '../twitter/tools.js';
import { searchSolanaTokensTool, getSolanaTrendingTokensTool, getSolanaRecentTokensTool, getSolanaTokenMarketDataTool } from '../solana/market-tools.js';

import { createImageGenTools } from '../imagegen/index.js';

// Configuration contains presence flags only. The native host attaches secrets to
// pinned requests. Registering tools never authenticates or contacts a provider.
export function credentialTools(enabled: string[] = []): BaseTool[] {
  const has = (id: string) => enabled.includes(id);
  const reference = 'nani-native-credential';
  const tools: BaseTool[] = [];
  if (has('perplexity.apiKey')) tools.push(...searchTools({ perplexityApiKey: reference }));
  if (has('coindesk.apiKey')) tools.push(...coindeskTools({ coindeskApiKey: reference }));
  if (has('coinmarketcal.apiKey')) tools.push(...createCoinMarketCalTools({ coinMarketCalApiKey: reference }));
  if (has('tally.apiKey')) tools.push(createTallyProposalsTool(reference), createTallyChainsTool(reference), createTallyUserDaosTool(reference));
  if (has('x.bearerToken') || (has('x.apiKey') && has('x.apiKeySecret'))) {
    tools.push(createSearchRecentTweetsTool(reference), createGetTweetByIdTool(reference), createGetUserByUsernameTool(reference), createGetUserTweetsTool(reference));
  }
  if (has('jupiter.apiKey')) tools.push(searchSolanaTokensTool, getSolanaTrendingTokensTool, getSolanaRecentTokensTool, getSolanaTokenMarketDataTool);
  if (has('fireworks.apiKey') && has('pinata.jwt')) tools.push(...createImageGenTools({fireworksApiKey: reference, pinataJWT: reference}));
  if (['x.apiKey', 'x.apiKeySecret', 'x.accessToken', 'x.accessTokenSecret'].every(has)) {
    // Shared tools keep timeline formatting; native host handles OAuth signatures.
    const get = async (path: string, params = {}) => {
      const query = new URLSearchParams(Object.entries(params).map(([k,v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]));
      const response = await fetch(`https://api.x.com/2/${path}?${query}`, {headers: {'x-nani-private': 'true'}});
      return response.json();
    };
    tools.push(createGetHomeTimelineTool({v2: {
      me: () => get('users/me'),
      homeTimeline: async (params: any) => {
        const me = await get('users/me');
        const result = await get(`users/${encodeURIComponent(me.data.id)}/timelines/reverse_chronological`, params);
        return {data: result};
      },
    }} as any));
  }
  return tools.map(tool => ({ ...tool, execute: async (client, args) => {
    const request = tool.parameters.parse(args);
    const result = await tool.execute(client, request);
    if (['searchSolanaTokens', 'getSolanaTrendingTokens', 'getSolanaRecentTokens', 'getSolanaTokenMarketData'].includes(tool.name)) {
      return {schemaVersion: 1, tool: tool.name, network: 'solana', cluster: 'mainnet-beta', request, observedAt: new Date().toISOString(), result};
    }
    return result;
  } }));
}

const origins = new Set(['https://api.perplexity.ai', 'https://api.tally.xyz', 'https://data-api.coindesk.com', 'https://developers.coinmarketcal.com', 'https://api.x.com', 'https://api.jup.ag', 'https://api.fireworks.ai', 'https://api.pinata.cloud']);

export function installCredentialTransport(host: (request: unknown) => Promise<any>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const request = new Request(input, options);
    if (!origins.has(new URL(request.url).origin)) return original(input, options);
    // No secrets cross into JavaScript; these headers are factory placeholders.
    const headers: Record<string, string> = {};
    for (const key of ['content-type', 'accept', 'x-nani-private']) {
      const value = request.headers.get(key);
      if (value) headers[key] = value;
    }
    const response = await host({ url: request.url, method: request.method, headers,
      body: request.method === 'GET' ? '' : encodeBytes(new Uint8Array(await request.arrayBuffer())) });
    if (response.error) throw new Error(response.error);
    if (!Number.isInteger(response.status) || response.status < 200 || response.status > 299) {
      throw new Error(`Provider request failed (HTTP ${response.status}). Check Tool API keys and your provider quota.`);
    }
    return new Response(Uint8Array.from(atob(response.body), c => c.charCodeAt(0)), { status: response.status, headers: { 'content-type': 'application/json' } });
  };
}

function encodeBytes(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
