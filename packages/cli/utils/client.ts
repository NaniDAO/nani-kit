import { type Hex, type Account, isHex, zeroAddress } from "viem";
import { createAgentekClient, type BaseTool } from "@agentek/tools/client";
import {
  allTools,
  DEFAULT_CHAINS,
  resolveTransports,
  parseRpcUrlsEnv,
} from "@agentek/tools";
import { privateKeyToAccount } from "viem/accounts";
import { resolveKeys } from "../config.js";
import { isDaemonReachable, getDaemonAddress, createDaemonAccount } from "../signer/client.js";
import { outputError } from "./output.js";

export async function createClientFromEnv() {
  // ── Environment (env vars override config file) ────────────────────────
  const keys = resolveKeys();
  const PRIVATE_KEY = keys.PRIVATE_KEY;
  const ACCOUNT = keys.ACCOUNT;
  const SOLANA_PRIVATE_KEY = keys.SOLANA_PRIVATE_KEY;
  const SOLANA_ACCOUNT = keys.SOLANA_ACCOUNT;
  const SOLANA_RPC_URL = keys.SOLANA_RPC_URL;
  const JUPITER_API_KEY = keys.JUPITER_API_KEY;
  const PERPLEXITY_API_KEY = keys.PERPLEXITY_API_KEY;
  const ZEROX_API_KEY = keys.ZEROX_API_KEY;
  const TALLY_API_KEY = keys.TALLY_API_KEY;
  const COINDESK_API_KEY = keys.COINDESK_API_KEY;
  const COINMARKETCAL_API_KEY = keys.COINMARKETCAL_API_KEY;
  const FIREWORKS_API_KEY = keys.FIREWORKS_API_KEY;
  const PINATA_JWT = keys.PINATA_JWT;
  const X_BEARER_TOKEN = keys.X_BEARER_TOKEN;
  const X_API_KEY = keys.X_API_KEY;
  const X_API_KEY_SECRET = keys.X_API_KEY_SECRET;
  const X_ACCESS_TOKEN = keys.X_ACCESS_TOKEN;
  const X_ACCESS_TOKEN_SECRET = keys.X_ACCESS_TOKEN_SECRET;

  if (PRIVATE_KEY && !isHex(PRIVATE_KEY)) {
    outputError("Invalid PRIVATE_KEY format, must be hex");
  }

  // ── Blockchain setup ─────────────────────────────────────────────────
  // Endpoints come from config or env (RPC_URLS, RPC_URL_<chainId>, or the
  // per-chain aliases) and fall back to known-good public ones. Every
  // transport is bounded, so a rate-limited endpoint fails instead of hanging.
  const chains = DEFAULT_CHAINS;
  // resolveTransports reads process.env on its own, but CLI keys can also come
  // from ~/.agentek/config.json, so the resolved values are passed in as
  // explicit overrides rather than relying on the env alone.
  const rpcOverrides: Record<number, string> = {
    ...parseRpcUrlsEnv(keys.RPC_URLS),
  };
  const RPC_ALIASES: Record<string, number> = {
    ETHEREUM_RPC_URL: 1,
    OPTIMISM_RPC_URL: 10,
    ARBITRUM_RPC_URL: 42161,
    POLYGON_RPC_URL: 137,
    BASE_RPC_URL: 8453,
    MODE_RPC_URL: 34443,
    SEPOLIA_RPC_URL: 11155111,
  };
  for (const [name, chainId] of Object.entries(RPC_ALIASES)) {
    const url = keys[name];
    if (url) rpcOverrides[chainId] = url;
  }
  const transports = resolveTransports(chains, rpcOverrides);

  // Prefer signing daemon if running, then PRIVATE_KEY, then ACCOUNT, then zeroAddress
  let account: Account | Hex;
  const daemonUp = await isDaemonReachable();
  if (daemonUp) {
    const addr = await getDaemonAddress();
    account = createDaemonAccount(addr);
  } else if (PRIVATE_KEY) {
    account = privateKeyToAccount(PRIVATE_KEY as Hex);
  } else {
    account = ACCOUNT && isHex(ACCOUNT) ? ACCOUNT as Hex : zeroAddress;
  }

  // ── Agentek client ───────────────────────────────────────────────────
  const agentekClient = createAgentekClient({
    transports,
    chains,
    accountOrAddress: account,
    solana: {
      rpcUrl: SOLANA_RPC_URL,
      privateKey: SOLANA_PRIVATE_KEY,
      address: SOLANA_ACCOUNT,
      jupiterApiKey: JUPITER_API_KEY,
    },
    tools: await allTools({
      perplexityApiKey: PERPLEXITY_API_KEY,
      zeroxApiKey: ZEROX_API_KEY,
      tallyApiKey: TALLY_API_KEY,
      coindeskApiKey: COINDESK_API_KEY,
      coinMarketCalApiKey: COINMARKETCAL_API_KEY,
      fireworksApiKey: FIREWORKS_API_KEY,
      pinataJWT: PINATA_JWT,
      xBearerToken: X_BEARER_TOKEN,
      xApiKey: X_API_KEY,
      xApiKeySecret: X_API_KEY_SECRET,
      xAccessToken: X_ACCESS_TOKEN,
      xAccessTokenSecret: X_ACCESS_TOKEN_SECRET,
    }),
  });

  const toolsMap = agentekClient.getTools() as Map<string, BaseTool>;

  return { agentekClient, toolsMap };
}

export type ClientContext = Awaited<ReturnType<typeof createClientFromEnv>>;
