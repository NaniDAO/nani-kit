import { type Address, type Hex, formatUnits } from "viem";
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";
import { z } from "zod";
import { type AgentekClient, createTool } from "../client.js";
import { robinhood } from "../chains/robinhood.js";
import { addressSchema } from "../utils.js";
import { assertOkResponse } from "../utils/fetch.js";

const supportedChains = [mainnet, optimism, arbitrum, polygon, base, robinhood];
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_TRANSFER_PAGES = 5;
const MAX_RESPONSE_BYTES = 2_000_000;

const chainInfo: Record<number, { name: string; blockscout: string; dex: string }> = {
  [mainnet.id]: { name: "Ethereum", blockscout: "https://eth.blockscout.com/api/v2", dex: "ethereum" },
  [optimism.id]: { name: "Optimism", blockscout: "https://optimism.blockscout.com/api/v2", dex: "optimism" },
  [arbitrum.id]: { name: "Arbitrum", blockscout: "https://arbitrum.blockscout.com/api/v2", dex: "arbitrum" },
  [polygon.id]: { name: "Polygon", blockscout: "https://polygon.blockscout.com/api/v2", dex: "polygon" },
  [base.id]: { name: "Base", blockscout: "https://base.blockscout.com/api/v2", dex: "base" },
  [robinhood.id]: { name: "Robinhood Chain", blockscout: "https://robinhoodchain.blockscout.com/api/v2", dex: "robinhood" },
};

const parameters = z.object({
  chainId: z.number().int().describe("EVM chain ID containing the contract"),
  address: addressSchema.describe("ERC-20, ERC-721, ERC-1155, or other contract address to research"),
});

type JsonObject = Record<string, any>;
type SourceResult = { ok: boolean; url: string; data?: any; error?: string };

const erc165Abi = [{
  type: "function", name: "supportsInterface", stateMutability: "view",
  inputs: [{ name: "interfaceId", type: "bytes4" }], outputs: [{ type: "bool" }],
}] as const;
const stringAbi = (name: string) => [{
  type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: "string" }],
}] as const;
const uintAbi = (name: string) => [{
  type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }],
}] as const;
const addressAbi = (name: string) => [{
  type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: "address" }],
}] as const;
const boolAbi = (name: string) => [{
  type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: "bool" }],
}] as const;

async function fetchJson(url: string): Promise<SourceResult> {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    await assertOkResponse(response, `Research source ${url}`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES) throw new Error(`Response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) throw new Error(`Response exceeds ${MAX_RESPONSE_BYTES} characters`);
    return { ok: true, url, data: JSON.parse(body) };
  } catch (error) {
    return { ok: false, url, error: error instanceof Error ? error.message : String(error) };
  }
}

function safeText(value: any, maxLength = 160): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

function queryUrl(base: string, path: string, query?: JsonObject): string {
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function addressHash(value: any): string | undefined {
  if (typeof value === "string") return value.toLowerCase();
  const hash = value?.hash ?? value?.address_hash;
  return typeof hash === "string" ? hash.toLowerCase() : undefined;
}

function decimalString(value: any): string | undefined {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function timestamp(value: any): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function pct(numerator: bigint, denominator: bigint): number | undefined {
  if (denominator <= 0n) return undefined;
  return Number((numerator * 1_000_000n) / denominator) / 10_000;
}

function inspectAbi(abi: any): { functions: string[]; functionsTruncated: boolean; capabilities: Record<string, boolean> } {
  const allFunctions = Array.isArray(abi)
    ? [...new Set(abi.filter((item) => item?.type === "function" && /^[A-Za-z_$][A-Za-z0-9_$]{0,99}$/.test(item.name)).map((item) => item.name as string))].sort()
    : [];
  const functions = allFunctions.slice(0, 100);
  const lower = new Set(functions.map((name) => name.toLowerCase()));
  const has = (...names: string[]) => names.some((name) => lower.has(name.toLowerCase()));
  return {
    functions,
    functionsTruncated: allFunctions.length > functions.length,
    capabilities: {
      ownershipFunctionPresent: has("owner", "getOwner", "transferOwnership", "renounceOwnership"),
      roleControlPresent: has("hasRole", "grantRole", "revokeRole", "getRoleAdmin"),
      mintFunctionPresent: has("mint", "mintTo", "safeMint", "ownerMint"),
      pauseFunctionPresent: has("pause", "unpause", "paused"),
      blacklistFunctionPresent: has("blacklist", "setBlacklist", "setBlacklisted", "isBlacklisted"),
      feeOrTaxSetterPresent: functions.some((name) => /^(set|update).*(fee|tax)/i.test(name)),
      tradingControlPresent: has("enableTrading", "setTradingEnabled", "openTrading"),
      upgradeFunctionPresent: has("upgradeTo", "upgradeToAndCall", "changeAdmin"),
    },
  };
}

function normalizePairs(data: any, tokenAddress: string) {
  const pairs = Array.isArray(data) ? data : Array.isArray(data?.pairs) ? data.pairs : [];
  const normalized = pairs.map((pair: any) => {
    const isBase = String(pair?.baseToken?.address).toLowerCase() === tokenAddress.toLowerCase();
    const counterToken = isBase ? pair?.quoteToken : pair?.baseToken;
    return ({
    pairAddress: safeText(pair?.pairAddress),
    dexId: safeText(pair?.dexId),
    url: safeText(pair?.url, 500),
    counterToken: counterToken ? { address: safeText(counterToken.address), symbol: safeText(counterToken.symbol) } : undefined,
    tokenSide: isBase ? "base" : "quote",
    priceUsd: decimalString(pair?.priceUsd),
    liquidityUsd: typeof pair?.liquidity?.usd === "number" ? pair.liquidity.usd : undefined,
    fdvUsd: typeof pair?.fdv === "number" ? pair.fdv : undefined,
    marketCapUsd: typeof pair?.marketCap === "number" ? pair.marketCap : undefined,
    volume: pair?.volume,
    transactions: pair?.txns,
    priceChangePercent: pair?.priceChange,
    pairCreatedAt: typeof pair?.pairCreatedAt === "number" ? new Date(pair.pairCreatedAt).toISOString() : undefined,
    });
  }).sort((a: any, b: any) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  const oldest = normalized.map((pair: any) => pair.pairCreatedAt).filter(Boolean).sort()[0];
  return {
    pairCount: normalized.length,
    reportedLiquidityUsdAcrossPairs: normalized.reduce((sum: number, pair: any) => sum + (pair.liquidityUsd ?? 0), 0),
    oldestPairCreatedAt: oldest,
    pairs: normalized.slice(0, 10),
    note: "Liquidity is summed across reported pools and is not a guaranteed executable amount. Obtain a fresh quote before trading.",
  };
}

async function readOptional(publicClient: any, address: Address, abi: any, functionName: string, args?: readonly unknown[]) {
  try {
    return await publicClient.readContract({ address, abi, functionName, args });
  } catch {
    return undefined;
  }
}

async function scanTransfers(base: string, address: Address): Promise<{ source: SourceResult; items: any[]; complete: boolean }> {
  let query: JsonObject | undefined;
  let lastSource: SourceResult = { ok: false, url: queryUrl(base, `/tokens/${address}/transfers`), error: "Not fetched" };
  const items: any[] = [];
  for (let page = 0; page < MAX_TRANSFER_PAGES; page += 1) {
    lastSource = await fetchJson(queryUrl(base, `/tokens/${address}/transfers`, query));
    if (!lastSource.ok) return { source: lastSource, items, complete: false };
    items.push(...(Array.isArray(lastSource.data?.items) ? lastSource.data.items : []));
    const next = lastSource.data?.next_page_params;
    if (!next || typeof next !== "object") return { source: lastSource, items, complete: true };
    query = next;
  }
  return { source: lastSource, items, complete: false };
}

export const researchCA = createTool({
  name: "researchCA",
  description: "Research an EVM contract address before trading. Returns deterministic on-chain identity and standard checks, verified-code/proxy/admin-surface facts, supply and holder concentration, bounded mint/transfer history with explicit completeness, and Dexscreener liquidity, volume, pool age, and trading activity. Supports ERC-20, ERC-721, ERC-1155, and other contracts; does not make a buy recommendation.",
  parameters,
  supportedChains,
  execute: async (client: AgentekClient, args: z.infer<typeof parameters>) => {
    const info = chainInfo[args.chainId];
    if (!info) throw new Error(`Unsupported research chain ${args.chainId}`);
    const observedAt = new Date().toISOString();
    const publicClient = client.getPublicClient(args.chainId);
    const address = args.address as Address;
    const urls = {
      address: queryUrl(info.blockscout, `/addresses/${address}`),
      contract: queryUrl(info.blockscout, `/smart-contracts/${address}`),
      token: queryUrl(info.blockscout, `/tokens/${address}`),
      holders: queryUrl(info.blockscout, `/tokens/${address}/holders`),
      market: `https://api.dexscreener.com/tokens/v1/${info.dex}/${address}`,
    };

    const [codeResult, addressResult, contractResult, tokenResult, holdersResult, marketResult, transferScan] = await Promise.all([
      publicClient.getCode({ address }).then((data: Hex | undefined) => ({ ok: true as const, data })).catch((error: unknown) => ({ ok: false as const, error })),
      fetchJson(urls.address), fetchJson(urls.contract), fetchJson(urls.token), fetchJson(urls.holders), fetchJson(urls.market),
      scanTransfers(info.blockscout, address),
    ]);

    const [erc721, erc1155, name, symbol, decimals, onchainSupply, owner, paused] = await Promise.all([
      readOptional(publicClient, address, erc165Abi, "supportsInterface", ["0x80ac58cd"]),
      readOptional(publicClient, address, erc165Abi, "supportsInterface", ["0xd9b67a26"]),
      readOptional(publicClient, address, stringAbi("name"), "name"),
      readOptional(publicClient, address, stringAbi("symbol"), "symbol"),
      readOptional(publicClient, address, uintAbi("decimals"), "decimals"),
      readOptional(publicClient, address, uintAbi("totalSupply"), "totalSupply"),
      readOptional(publicClient, address, addressAbi("owner"), "owner"),
      readOptional(publicClient, address, boolAbi("paused"), "paused"),
    ]);

    const explorerType = tokenResult.data?.type;
    const standard = erc721 === true || explorerType === "ERC-721" ? "ERC721"
      : erc1155 === true || explorerType === "ERC-1155" ? "ERC1155"
      : decimals !== undefined || explorerType === "ERC-20" ? "ERC20"
      : codeResult.ok ? (codeResult.data && codeResult.data !== "0x" ? "contract" : "EOA_OR_UNDEPLOYED")
      : addressResult.data?.is_contract === true ? "contract"
      : "UNKNOWN";
    const abiInspection = inspectAbi(contractResult.data?.abi);
    const supplyRaw = decimalString(onchainSupply) ?? decimalString(tokenResult.data?.total_supply);
    const supply = supplyRaw && decimals !== undefined && Number(decimals) <= 30 && /^\d+$/.test(supplyRaw)
      ? formatUnits(BigInt(supplyRaw), Number(decimals))
      : undefined;

    const creationTransactionHash = contractResult.data?.creation_tx_hash ?? addressResult.data?.creation_tx_hash;
    const creationResult = typeof creationTransactionHash === "string"
      ? await fetchJson(queryUrl(info.blockscout, `/transactions/${creationTransactionHash}`))
      : undefined;
    const deployedAt = timestamp(creationResult?.data?.timestamp);

    const holders = Array.isArray(holdersResult.data?.items) ? holdersResult.data.items : [];
    const denominator = supplyRaw && /^\d+$/.test(supplyRaw) ? BigInt(supplyRaw) : 0n;
    const holderRows = holders.slice(0, 20).map((holder: any) => {
      const raw = decimalString(holder?.value) ?? "0";
      const value = /^\d+$/.test(raw) ? BigInt(raw) : 0n;
      return {
        address: addressHash(holder?.address) ?? addressHash(holder),
        balanceRaw: raw,
        sharePercent: pct(value, denominator),
        isContract: holder?.address?.is_contract,
      };
    });
    const nonBurn = holderRows.filter((holder: any) => holder.address !== ZERO_ADDRESS);
    const top10Balance = nonBurn.slice(0, 10).reduce((sum: bigint, holder: any) => sum + (/^\d+$/.test(holder.balanceRaw) ? BigInt(holder.balanceRaw) : 0n), 0n);

    const transferTimes = transferScan.items.map((item) => timestamp(item?.timestamp)).filter((value): value is string => Boolean(value)).sort();
    const mintItems = transferScan.items.filter((item) => addressHash(item?.from) === ZERO_ADDRESS);
    let mintedUnits = 0n;
    for (const item of mintItems) {
      if (Array.isArray(item?.token_ids)) mintedUnits += BigInt(item.token_ids.length);
      else {
        const raw = decimalString(item?.total?.value) ?? decimalString(item?.value);
        if (raw && /^\d+$/.test(raw)) mintedUnits += BigInt(raw);
      }
    }

    const market = normalizePairs(marketResult.data, address);
    const warnings: string[] = [];
    if (!codeResult.ok) warnings.push("On-chain bytecode could not be read; contract-vs-EOA classification may be unknown.");
    if (!contractResult.data?.is_verified) warnings.push("Contract source is not verified on the configured explorer; ABI capability checks may be incomplete.");
    if (contractResult.data?.is_proxy) warnings.push("This is reported as a proxy; implementation and upgrade authority matter more than proxy source alone.");
    if (!transferScan.complete) warnings.push(`Mint/transfer history is partial: at most ${MAX_TRANSFER_PAGES} explorer pages were scanned.`);
    if (!marketResult.ok || market.pairCount === 0) warnings.push("No Dexscreener pool data was found; this does not prove the asset is untradeable.");
    if (abiInspection.capabilities.mintFunctionPresent) warnings.push("Verified ABI exposes a mint-named function; presence alone does not prove it is publicly callable.");
    if (abiInspection.capabilities.blacklistFunctionPresent || abiInspection.capabilities.tradingControlPresent) warnings.push("Verified ABI exposes blacklist or trading-control functions; inspect access control before trading.");

    return {
      schemaVersion: 1,
      observedAt,
      chain: { id: args.chainId, name: info.name },
      address,
      classification: {
        standard,
        evidence: { explorerType, erc721Interface: erc721, erc1155Interface: erc1155, decimalsReadable: decimals !== undefined },
      },
      contract: {
        hasCode: codeResult.ok ? Boolean(codeResult.data && codeResult.data !== "0x") : undefined,
        codeCheckError: codeResult.ok ? undefined : String(codeResult.error),
        verified: contractResult.data?.is_verified,
        name: safeText(contractResult.data?.name),
        compilerVersion: safeText(contractResult.data?.compiler_version),
        language: safeText(contractResult.data?.language),
        isProxy: contractResult.data?.is_proxy,
        implementationAddresses: Array.isArray(contractResult.data?.implementations)
          ? contractResult.data.implementations.map((implementation: any) => addressHash(implementation)).filter(Boolean)
          : [],
        creator: addressHash(contractResult.data?.creator_address_hash) ?? addressHash(addressResult.data?.creator_address_hash),
        creationTransactionHash,
        deployedAt,
        ageSeconds: deployedAt ? Math.max(0, Math.floor((Date.parse(observedAt) - Date.parse(deployedAt)) / 1000)) : undefined,
        owner: typeof owner === "string" ? owner : undefined,
        ownershipRenounced: typeof owner === "string" ? owner.toLowerCase() === ZERO_ADDRESS : undefined,
        paused: typeof paused === "boolean" ? paused : undefined,
        abi: abiInspection,
      },
      token: {
        name: safeText(typeof name === "string" ? name : tokenResult.data?.name),
        symbol: safeText(typeof symbol === "string" ? symbol : tokenResult.data?.symbol, 40),
        decimals: decimals !== undefined ? Number(decimals) : tokenResult.data?.decimals,
        currentSupplyRaw: supplyRaw,
        currentSupplyFormatted: supply,
        explorerHoldersCount: tokenResult.data?.holders_count,
      },
      holders: {
        returned: holderRows.length,
        top10NonBurnSharePercent: pct(top10Balance, denominator),
        entries: holderRows,
        completeness: "Explorer-ranked sample; contract and liquidity-pool addresses are labeled when the explorer provides that fact but are not automatically excluded.",
      },
      mintAndTransferHistory: {
        itemsScanned: transferScan.items.length,
        complete: transferScan.complete,
        earliestObservedAt: transferTimes[0],
        latestObservedAt: transferTimes.at(-1),
        firstMintObservedAt: mintItems.map((item) => timestamp(item?.timestamp)).filter(Boolean).sort()[0],
        mintEventsObserved: mintItems.length,
        mintedUnitsObservedRaw: mintedUnits.toString(),
        qualification: transferScan.complete
          ? "Complete for transfers returned by the explorer pagination at observation time. Current supply may differ from all-time minted units because of burns."
          : `Lower bounds from ${transferScan.items.length} transfers; do not treat observed mint count or first mint as all-time values.`,
      },
      market,
      warnings,
      sources: [addressResult, contractResult, tokenResult, holdersResult, transferScan.source, marketResult, creationResult]
        .filter((source): source is SourceResult => Boolean(source))
        .map(({ ok, url, error }) => ({ ok, url, error })),
    };
  },
});
