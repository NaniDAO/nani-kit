/**
 * WKWebView entry point for nani-macos.
 *
 * Loaded into a hidden WKWebView. Swift calls these globals via callAsyncJavaScript().
 * No IPC, no child process, no MCP SDK.
 *
 * Exports:
 *   __naniInit(account?, rpcUrlsByChainId?, solana?) -> number (tool count)
 *     - account: 0x address; defaults to zeroAddress
 *     - rpcUrlsByChainId: e.g. { "1": "https://...", "11155111": "https://..." }
 *       Per-chain RPC URLs the user configured in Settings. Falls back to the
 *       chain's viem default when a chain is not present in the map.
 *     - solana: optional public address, RPC URL and Jupiter API key. The key
 *       remains client configuration and never appears in a tool schema.
 *   __naniList() -> string (JSON array of {name, description, schema})
 *   __naniCall(name, argsJSON) -> Promise<string> (JSON {result} or {error})
 */

import { type Hex, http, isHex, zeroAddress } from "viem";
import { mainnet, optimism, arbitrum, polygon, base, sepolia } from "viem/chains";
import { createAgentekClient, type BaseTool } from "@agentek/tools/client";
import { zodToJsonSchema } from "zod-to-json-schema";

import { ensTools } from "../shared/ens/index.js";
import { erc20Tools } from "../shared/erc20/index.js";
import { rpcTools } from "../shared/rpc/index.js";
import { transferTools } from "../shared/transfer/index.js";
import { swapTools } from "../shared/swap/index.js";
import { blockscoutTools } from "../shared/blockscout/index.js";
import { aaveTools } from "../shared/aave/index.js";
import { acrossTools } from "../shared/across/index.js";
import { uniV3Tools } from "../shared/uniV3/index.js";
import { wethTools } from "../shared/weth/index.js";
import { naniTools } from "../shared/nani/index.js";
import { securityTools } from "../shared/security/index.js";
import { webTools } from "../shared/web/index.js";
import { fearGreedIndexTools } from "../shared/feargreed/index.js";
import { nftTools } from "../shared/erc721/index.js";
import { cryptoPriceTools } from "../shared/cryptoprices/index.js";
import { gasEstimatorTools } from "../shared/gasestimator/index.js";
import { defillamaTools } from "../shared/defillama/index.js";
import { dexscreenerTools } from "../shared/dexscreener/index.js";
import { thinkTools } from "../shared/think/index.js";
import { zammTools } from "../shared/zamm/index.js";
import { zrouterTools } from "../shared/zrouter/index.js";
import { wnsTools } from "../shared/wns/index.js";
import { searchTools } from "../shared/search/index.js";
import { resolveTokenTools } from "../shared/resolveToken/index.js";
import { approvalTools } from "../shared/approvals/index.js";
import { contractTools } from "../shared/contract/index.js";
import { solanaMarketTools } from "../shared/solana/market-tools.js";

interface NaniSolanaConfig {
  address?: string;
  rpcUrl?: string;
  jupiterApiKey?: string;
}

const TOOL_TIMEOUT_MS = 120_000;

let toolsMap: Map<string, BaseTool> | null = null;
let agentekClient: ReturnType<typeof createAgentekClient> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Initialize the tool engine. Call once at startup.
 * Returns the number of tools loaded.
 */
(globalThis as any).__naniInit = (
  accountAddress?: string,
  rpcUrlsByChainId?: Record<string, string>,
  solana?: NaniSolanaConfig,
): number => {
  const chains = [mainnet, optimism, arbitrum, polygon, base, sepolia];
  const transports = chains.map((chain) => {
    const customUrl = rpcUrlsByChainId?.[String(chain.id)];
    return customUrl ? http(customUrl) : http();
  });

  const account = accountAddress && isHex(accountAddress)
    ? accountAddress as Hex
    : zeroAddress;

  const tools = [
    ...ensTools(), ...erc20Tools(), ...rpcTools(), ...transferTools(),
    ...blockscoutTools(), ...aaveTools(), ...acrossTools(), ...uniV3Tools(),
    ...wethTools(), ...naniTools(), ...securityTools(), ...webTools(),
    ...fearGreedIndexTools(), ...nftTools(), ...cryptoPriceTools(),
    ...gasEstimatorTools(), ...defillamaTools(), ...dexscreenerTools(),
    ...thinkTools(), ...zammTools(), ...zrouterTools(), ...wnsTools(),
    ...resolveTokenTools(), ...approvalTools(), ...contractTools(),
    ...solanaMarketTools({
      includeJupiter: true,
      includeIntents: false,
    }),
  ];

  agentekClient = createAgentekClient({
    transports,
    chains,
    accountOrAddress: account,
    tools,
    solana,
  });

  toolsMap = agentekClient.getTools() as Map<string, BaseTool>;
  return toolsMap.size;
};

/**
 * List available tools with schemas. Returns JSON string.
 * Schema is a simplified JSON Schema with {properties, required} for ToolFilter.buildSystemPrompt().
 */
(globalThis as any).__naniList = (): string => {
  if (!toolsMap) return "[]";
  const list = Array.from(toolsMap.entries()).map(([name, tool]) => {
    let schema: Record<string, unknown> = {};
    try {
      const full = zodToJsonSchema(tool.parameters, { target: "jsonSchema7" }) as Record<string, unknown>;
      schema = { properties: full.properties ?? {}, required: full.required ?? [] };
    } catch {}
    return { name, description: tool.description, schema };
  });
  return JSON.stringify(list);
};

/**
 * Call a tool. Returns a JSON string with {result} or {error}.
 * Swift must call this and handle the returned Promise.
 */
(globalThis as any).__naniCall = async (name: string, argsJSON: string): Promise<string> => {
  if (!toolsMap || !agentekClient) {
    return JSON.stringify({ error: "Not initialized" });
  }

  if (!toolsMap.has(name)) {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  try {
    const args = JSON.parse(argsJSON);
    const result = await withTimeout(
      agentekClient.execute(name, args),
      TOOL_TIMEOUT_MS,
      name,
    );
    const text = typeof result === "object" ? JSON.stringify(result) : String(result);
    return JSON.stringify({ result: text });
  } catch (err) {
    return JSON.stringify({ error: String(err instanceof Error ? err.message : err) });
  }
};
