import { http, type Chain, type Transport } from "viem";
import {
  arbitrum,
  base,
  mainnet,
  mode,
  optimism,
  polygon,
  sepolia,
} from "viem/chains";

/**
 * The chains agentek's own tools declare in their `supportedChains`.
 *
 * The CLI and the MCP server used to build a shorter list, which meant ~26
 * tools advertised Mode and Sepolia to the model and then failed on use —
 * loudly for reads ("No public client for chain 11155111"), and quietly for
 * `depositWETH`, which happily returned a signable Sepolia intent from a client
 * that had no Sepolia transport and only failed at send time.
 */
export const DEFAULT_CHAINS: Chain[] = [
  mainnet,
  optimism,
  arbitrum,
  polygon,
  base,
  mode,
  sepolia,
];

/**
 * Public endpoints used when nothing is configured.
 *
 * viem's built-in defaults are not a safe fallback here: mainnet's
 * (`eth.merkle.io`) answers 429 with a long `Retry-After`, and because viem
 * honours it across three retries, a single `eth_blockNumber` did not settle
 * in ninety seconds. These are endpoints that answered reliably; they are
 * still shared public infrastructure, so configure your own for real use.
 */
const FALLBACK_RPC_URLS: Record<number, string> = {
  [mainnet.id]: "https://ethereum-rpc.publicnode.com",
  [optimism.id]: "https://optimism-rpc.publicnode.com",
  [arbitrum.id]: "https://arbitrum-one-rpc.publicnode.com",
  [polygon.id]: "https://polygon-bor-rpc.publicnode.com",
  [base.id]: "https://base-rpc.publicnode.com",
  [mode.id]: "https://mainnet.mode.network",
  [sepolia.id]: "https://ethereum-sepolia-rpc.publicnode.com",
};

/** Friendly per-chain env aliases, alongside the generic RPC_URL_<chainId>. */
const ENV_ALIASES: Record<number, string> = {
  [mainnet.id]: "ETHEREUM_RPC_URL",
  [optimism.id]: "OPTIMISM_RPC_URL",
  [arbitrum.id]: "ARBITRUM_RPC_URL",
  [polygon.id]: "POLYGON_RPC_URL",
  [base.id]: "BASE_RPC_URL",
  [mode.id]: "MODE_RPC_URL",
  [sepolia.id]: "SEPOLIA_RPC_URL",
};

const env = (name: string): string | undefined =>
  typeof process !== "undefined" ? process.env?.[name] : undefined;

/**
 * The RPC URL for a chain, in precedence order: an explicit override, then
 * `RPC_URL_<chainId>`, then the friendly alias, then a known-good public
 * endpoint. Returns undefined only for a chain we have no default for, in
 * which case viem's own default is used.
 */
export function resolveRpcUrl(
  chainId: number,
  overrides?: Record<number, string>,
): string | undefined {
  return (
    overrides?.[chainId] ||
    env(`RPC_URL_${chainId}`) ||
    (ENV_ALIASES[chainId] ? env(ENV_ALIASES[chainId]) : undefined) ||
    FALLBACK_RPC_URLS[chainId]
  );
}

/**
 * Transports for a set of chains.
 *
 * Every transport is bounded: without an explicit timeout a rate-limited
 * endpoint stalls the whole call for as long as it cares to, since viem waits
 * out `Retry-After` on each of its retries.
 */
export function resolveTransports(
  chains: Chain[] = DEFAULT_CHAINS,
  overrides?: Record<number, string>,
): Transport[] {
  return chains.map((chain) =>
    http(resolveRpcUrl(chain.id, overrides), {
      timeout: 15_000,
      retryCount: 2,
      retryDelay: 250,
    }),
  );
}

/** Parse `RPC_URLS` — a `chainId=url` comma-separated list — into overrides. */
export function parseRpcUrlsEnv(
  value: string | undefined,
): Record<number, string> | undefined {
  if (!value) return undefined;
  const out: Record<number, string> = {};
  for (const entry of value.split(",")) {
    const [id, ...rest] = entry.split("=");
    const url = rest.join("=").trim();
    const chainId = Number(id?.trim());
    if (Number.isFinite(chainId) && url) out[chainId] = url;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
