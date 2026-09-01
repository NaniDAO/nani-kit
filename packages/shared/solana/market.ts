import { assertOkResponse } from "../utils/fetch.js";
import { SOLANA_TOKENS } from "./constants.js";
import { resolveSolanaMint, solanaAddressSchema } from "./utils.js";

export const JUPITER_API_BASE_URL = "https://api.jup.ag";
export const DEXSCREENER_API_BASE_URL = "https://api.dexscreener.com";

export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type JupiterTokenCategory =
  | "toptrending"
  | "toptraded"
  | "toporganicscore";

export type JupiterTokenInterval = "5m" | "1h" | "6h" | "24h";

export interface JupiterSwapOrder {
  transaction: string | null;
  requestId: string;
  outAmount: string;
  router: string;
  mode: string;
  feeBps: number;
  feeMint: string;
  lastValidBlockHeight?: string;
  errorCode?: number;
  errorMessage?: string;
  [key: string]: unknown;
}

export interface JupiterSwapOrderRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker?: string;
  slippageBps?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getJSON = async (
  url: URL,
  context: string,
  fetcher: Fetcher,
  apiKey?: string,
): Promise<unknown> => {
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = apiKey?.trim();
  if (key) headers["x-api-key"] = key;

  // These clients only need the exact, pinned provider origin. Refuse redirects
  // so a compromised or misconfigured provider cannot move a credentialed
  // request (or its trust decision) to a different endpoint.
  const response = await fetcher(url, { headers, redirect: "error" });
  await assertOkResponse(response, context);
  return response.json();
};

/**
 * Anyone can mint a token, which makes every name, symbol and description in
 * these listings attacker-authored text that reaches the model verbatim.
 * Strip what lets a value fake structure - control characters and line breaks,
 * which are how a "name" impersonates tool output or a system message - and
 * cap the length so one field cannot bury the rest of the response.
 *
 * This removes the shape of an injection, not the possibility of one. Provider
 * listings stay untrusted input: discovery signals to look into, never
 * instructions and never a safety verdict.
 */
const MAX_PROVIDER_STRING = 512;

const sanitizeProviderValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    const flattened = value
      .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return flattened.length > MAX_PROVIDER_STRING
      ? `${flattened.slice(0, MAX_PROVIDER_STRING)}… [truncated]`
      : flattened;
  }
  if (Array.isArray(value)) return value.map(sanitizeProviderValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizeProviderValue(entry),
      ]),
    );
  }
  return value;
};

/**
 * Every listing endpoint funnels through here, so it is also where provider
 * text gets sanitized. Deliberately not applied to the swap order, whose
 * base64 transaction must survive byte for byte.
 */
const asArray = (value: unknown, context: string): Record<string, unknown>[] => {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`${context}: expected an array of objects`);
  }
  return value.map(
    (entry) => sanitizeProviderValue(entry) as Record<string, unknown>,
  );
};

const exactPositiveInteger = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    throw new Error(`${label} must be a positive integer in raw base units`);
  }
  return normalized;
};

export const resolveSolanaSwapMint = (token: string): string =>
  token.trim().toUpperCase() === "SOL"
    ? SOLANA_TOKENS.WSOL
    : resolveSolanaMint(token);

export const searchJupiterTokens = async (
  query: string,
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>[]> => {
  const normalized = query.trim();
  if (!normalized) throw new Error("Jupiter token search query cannot be empty");
  const url = new URL("/tokens/v2/search", JUPITER_API_BASE_URL);
  url.searchParams.set("query", normalized);
  return asArray(
    await getJSON(url, "Jupiter token search failed", fetcher, apiKey),
    "Jupiter token search",
  );
};

export const getJupiterTopTokens = async (
  category: JupiterTokenCategory,
  interval: JupiterTokenInterval,
  limit: number,
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>[]> => {
  const url = new URL(`/tokens/v2/${category}/${interval}`, JUPITER_API_BASE_URL);
  url.searchParams.set("limit", String(limit));
  return asArray(
    await getJSON(url, "Jupiter top tokens request failed", fetcher, apiKey),
    "Jupiter top tokens",
  );
};

export const getJupiterRecentTokens = async (
  limit: number,
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>[]> => {
  const url = new URL("/tokens/v2/recent", JUPITER_API_BASE_URL);
  const tokens = asArray(
    await getJSON(url, "Jupiter recent tokens request failed", fetcher, apiKey),
    "Jupiter recent tokens",
  );
  return tokens.slice(0, limit);
};

export const getJupiterTokenByMint = async (
  mint: string,
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>> => {
  const canonicalMint = resolveSolanaMint(mint);
  const tokens = await searchJupiterTokens(canonicalMint, apiKey, fetcher);
  const exact = tokens.find((token) => token.id === canonicalMint);
  if (!exact) {
    throw new Error(`Jupiter has no token record for mint ${canonicalMint}`);
  }
  return exact;
};

export const getJupiterSwapOrder = async (
  request: JupiterSwapOrderRequest,
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<JupiterSwapOrder> => {
  const inputMint = resolveSolanaSwapMint(request.inputMint);
  const outputMint = resolveSolanaSwapMint(request.outputMint);
  if (inputMint === outputMint) {
    throw new Error("Jupiter swap input and output mints must differ");
  }

  const url = new URL("/swap/v2/order", JUPITER_API_BASE_URL);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", exactPositiveInteger(request.amount, "Swap amount"));
  if (request.taker) {
    url.searchParams.set("taker", solanaAddressSchema.parse(request.taker));
  }
  if (request.slippageBps !== undefined) {
    url.searchParams.set("slippageBps", String(request.slippageBps));
  }

  const value = await getJSON(url, "Jupiter swap order failed", fetcher, apiKey);
  if (!isRecord(value)) throw new Error("Jupiter swap order: expected an object");
  if (typeof value.errorMessage === "string" && value.errorMessage) {
    throw new Error(`Jupiter swap order failed: ${value.errorMessage}`);
  }
  if (
    typeof value.requestId !== "string" ||
    typeof value.outAmount !== "string" ||
    !/^[0-9]+$/.test(value.outAmount) ||
    typeof value.router !== "string" ||
    typeof value.mode !== "string" ||
    typeof value.feeBps !== "number" ||
    !Number.isFinite(value.feeBps) ||
    typeof value.feeMint !== "string"
  ) {
    throw new Error("Jupiter swap order: missing or invalid quote fields");
  }

  return value as unknown as JupiterSwapOrder;
};

const dexArray = (value: unknown, context: string): Record<string, unknown>[] => {
  if (Array.isArray(value)) return asArray(value, context);
  if (isRecord(value) && Array.isArray(value.pairs)) {
    return asArray(value.pairs, context);
  }
  throw new Error(`${context}: expected an array or a pairs array`);
};

export const getDexscreenerSolanaProfiles = async (
  limit: number,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>[]> => {
  const url = new URL("/token-profiles/latest/v1", DEXSCREENER_API_BASE_URL);
  const profiles = asArray(
    await getJSON(url, "Dexscreener token profiles request failed", fetcher),
    "Dexscreener token profiles",
  );
  return profiles
    .filter((profile) => String(profile.chainId).toLowerCase() === "solana")
    .slice(0, limit);
};

export const getDexscreenerSolanaPromotions = async (
  limit: number,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>[]> => {
  const url = new URL("/token-boosts/top/v1", DEXSCREENER_API_BASE_URL);
  const promotions = asArray(
    await getJSON(url, "Dexscreener token promotions request failed", fetcher),
    "Dexscreener token promotions",
  );
  return promotions
    .filter((promotion) => String(promotion.chainId).toLowerCase() === "solana")
    .slice(0, limit);
};

const liquidityUSD = (pair: Record<string, unknown>): number => {
  const liquidity = isRecord(pair.liquidity) ? pair.liquidity.usd : undefined;
  const number = typeof liquidity === "number" ? liquidity : Number(liquidity ?? 0);
  return Number.isFinite(number) ? number : 0;
};

export const getDexscreenerSolanaPairs = async (
  mint: string,
  limit: number,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>[]> => {
  const canonicalMint = resolveSolanaMint(mint);
  const url = new URL(
    `/token-pairs/v1/solana/${canonicalMint}`,
    DEXSCREENER_API_BASE_URL,
  );
  const pairs = dexArray(
    await getJSON(url, "Dexscreener token pairs request failed", fetcher),
    "Dexscreener token pairs",
  );
  return pairs
    .filter((pair) => String(pair.chainId).toLowerCase() === "solana")
    .sort((a, b) => liquidityUSD(b) - liquidityUSD(a))
    .slice(0, limit);
};
