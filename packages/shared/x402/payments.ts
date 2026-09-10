import { z } from "zod";
import { getAddress, isAddress } from "viem";
import { createTool, type BaseTool } from "../client.js";
import { X402_DISCOVERY_URL } from "./constants.js";

// Browser-compatible x402 helpers for hosts that review and sign natively.
// Nothing here signs, holds a wallet, or retries a request with payment.
// Wire format follows @x402/core and @x402/evm 2.4.0 (exact scheme, EIP-3009).

const V1_NETWORKS: Record<string, number> = {
  ethereum: 1, sepolia: 11155111, base: 8453, "base-sepolia": 84532, polygon: 137,
};
const MAX_HEADER = 16_384;
const MAX_BODY = 65_536;
const MAX_ACCEPTS = 16;

const responseInput = z.object({
  status: z.number().int(),
  paymentRequiredHeader: z.string().max(MAX_HEADER).optional(),
  body: z.string().max(MAX_BODY).optional(),
}).strict();

const planInput = responseInput.extend({
  index: z.number().int().min(0).max(MAX_ACCEPTS - 1),
  payer: z.string(),
  nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  now: z.number().int().positive(),
}).strict();

export interface X402Requirement {
  index: number;
  scheme: string;
  network: string;
  chainId: number | null;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name?: string; version?: string; assetTransferMethod?: string };
  description?: string;
  mimeType?: string;
  supported: boolean;
  reason?: string;
}

function text(value: unknown, limit: number): string | undefined {
  return typeof value === "string" ? value.slice(0, limit) : undefined;
}

/** Drops undefined fields so source and bridged (JSON) results are identical. */
function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function decodeBase64JSON(value: string): any {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) throw new Error("The payment requirements header is not base64.");
  const bytes = Uint8Array.from(atob(trimmed), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function chainIdFor(version: 1 | 2, network: unknown): number | null {
  if (typeof network !== "string") return null;
  if (version === 1) return V1_NETWORKS[network] ?? null;
  const match = /^eip155:([1-9][0-9]{0,15})$/.exec(network);
  return match ? Number(match[1]) : null;
}

function normalizeRequirement(version: 1 | 2, raw: unknown, index: number): X402Requirement {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const extra = (r.extra && typeof r.extra === "object" ? r.extra : {}) as Record<string, unknown>;
  const amount = String((version === 2 ? r.amount : r.maxAmountRequired) ?? "");
  const chainId = chainIdFor(version, r.network);
  let reason: string | undefined;
  if (r.scheme !== "exact") reason = `Unsupported payment scheme: ${String(r.scheme)}.`;
  else if (chainId === null) reason = `Unsupported network: ${String(r.network)}.`;
  else if (!/^[0-9]{1,78}$/.test(amount) || BigInt(amount) === 0n) reason = "The price is missing or not an exact positive integer.";
  else if (typeof r.asset !== "string" || !isAddress(r.asset, { strict: false })) reason = "The payment asset is not an EVM token address.";
  else if (typeof r.payTo !== "string" || !isAddress(r.payTo, { strict: false })) reason = "The recipient is not an EVM address.";
  else if (!Number.isInteger(r.maxTimeoutSeconds) || r.maxTimeoutSeconds < 1 || r.maxTimeoutSeconds > 86_400) reason = "The payment validity window is missing or invalid.";
  else if (extra.assetTransferMethod !== undefined && extra.assetTransferMethod !== "eip3009") reason = `Unsupported transfer method: ${String(extra.assetTransferMethod)}.`;
  else if (typeof extra.name !== "string" || typeof extra.version !== "string") reason = "The token signing domain (name and version) is missing.";
  return compact({
    index,
    scheme: String(r.scheme ?? ""),
    network: String(r.network ?? ""),
    chainId,
    amount,
    asset: typeof r.asset === "string" ? r.asset : "",
    payTo: typeof r.payTo === "string" ? r.payTo : "",
    maxTimeoutSeconds: Number.isInteger(r.maxTimeoutSeconds) ? r.maxTimeoutSeconds : 0,
    extra: compact({
      name: text(extra.name, 100),
      version: text(extra.version, 20),
      assetTransferMethod: text(extra.assetTransferMethod, 40),
    }),
    description: text(r.description, 500),
    mimeType: text(r.mimeType, 100),
    supported: reason === undefined,
    reason,
  });
}

function parse(input: z.infer<typeof responseInput>) {
  if (input.status !== 402) throw new Error(`Expected HTTP 402 Payment Required, got ${input.status}.`);
  let document: any;
  let version: 1 | 2;
  if (input.paymentRequiredHeader) {
    document = decodeBase64JSON(input.paymentRequiredHeader);
    if (document?.x402Version !== 2) throw new Error("The PAYMENT-REQUIRED header is not x402 version 2.");
    version = 2;
  } else {
    try { document = JSON.parse(input.body ?? ""); } catch { throw new Error("The 402 response has no readable payment requirements."); }
    if (document?.x402Version !== 1) throw new Error("The 402 response body is not x402 version 1.");
    version = 1;
  }
  if (!Array.isArray(document.accepts) || document.accepts.length === 0) throw new Error("The service lists no payment options.");
  if (document.accepts.length > MAX_ACCEPTS) throw new Error("The service lists too many payment options.");
  const accepts = document.accepts.map((raw: unknown, index: number) => normalizeRequirement(version, raw, index));
  const first = document.accepts[0] ?? {};
  const resource = compact(version === 2
    ? { url: text(document.resource?.url, 2_000), description: text(document.resource?.description, 500), mimeType: text(document.resource?.mimeType, 100) }
    : { url: text(first.resource, 2_000), description: text(first.description, 500), mimeType: text(first.mimeType, 100) });
  return { version, document, accepts: accepts as X402Requirement[], resource, error: text(document.error, 500) };
}

/** Normalizes an HTTP 402 response. Unsupported options stay listed with a reason. */
export function parsePaymentRequired(input: unknown) {
  const parsed = parse(responseInput.parse(input));
  return compact({ schemaVersion: 1, x402Version: parsed.version, error: parsed.error, resource: parsed.resource, accepts: parsed.accepts });
}

/**
 * Builds the unsigned EIP-3009 TransferWithAuthorization for one option, exactly as
 * @x402/evm would before signing. The host supplies the nonce and clock, reviews the
 * result independently, signs, and places the signature in paymentTemplate.payload.
 */
export function planPayment(input: unknown) {
  const args = planInput.parse(input);
  if (!isAddress(args.payer, { strict: false })) throw new Error("Invalid payer address.");
  const parsed = parse(args);
  const requirement = parsed.accepts[args.index];
  if (!requirement) throw new Error("There is no payment option at that index.");
  if (!requirement.supported) throw new Error(requirement.reason ?? "Unsupported payment option.");
  const raw = parsed.document.accepts[args.index];
  const authorization = {
    from: getAddress(args.payer),
    to: getAddress(requirement.payTo),
    value: requirement.amount,
    validAfter: String(args.now - 600),
    validBefore: String(args.now + requirement.maxTimeoutSeconds),
    nonce: args.nonce.toLowerCase(),
  };
  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    domain: {
      name: requirement.extra.name,
      version: requirement.extra.version,
      chainId: requirement.chainId,
      verifyingContract: getAddress(requirement.asset),
    },
    message: authorization,
  };
  const payload = { authorization, signature: "" };
  const paymentTemplate = parsed.version === 2
    ? {
        x402Version: 2, payload, resource: parsed.document.resource, accepted: raw,
        ...(parsed.document.extensions !== undefined ? { extensions: parsed.document.extensions } : {}),
      }
    : { x402Version: 1, scheme: raw.scheme, network: raw.network, payload };
  return {
    schemaVersion: 1,
    x402Version: parsed.version,
    headerName: parsed.version === 2 ? "PAYMENT-SIGNATURE" : "X-PAYMENT",
    requirement,
    resource: parsed.resource,
    typedData,
    paymentTemplate,
  };
}

export const x402ParsePaymentRequiredTool = createTool({
  name: "x402ParsePaymentRequired",
  description: "Host-only. Normalize an HTTP 402 x402 response into payment options. Never contacts a service or pays.",
  parameters: responseInput,
  execute: async (_client, args) => parsePaymentRequired(args),
});

export const x402PlanPaymentTool = createTool({
  name: "x402PlanPayment",
  description: "Host-only. Build the unsigned EIP-3009 authorization for one x402 payment option. Never signs or pays.",
  parameters: planInput,
  execute: async (_client, args) => planPayment(args),
});

export const x402DiscoverResourcesTool = createTool({
  name: "x402DiscoverResources",
  description:
    "Search Coinbase's x402 Bazaar for paid HTTP services and their listed prices. Listings are written by the providers and are not verified. Amounts are in the asset's base units (USDC has 6 decimals). Nothing is bought.",
  parameters: z.object({
    query: z.string().max(100).optional().describe("Keyword to search for"),
    limit: z.number().int().min(1).max(20).optional().describe("Results to return (default 10)"),
    offset: z.number().int().min(0).max(1_000).optional(),
  }),
  execute: async (_client, args) => {
    const url = new URL(X402_DISCOVERY_URL);
    url.searchParams.set("type", "http");
    url.searchParams.set("limit", String(args.limit ?? 10));
    if (args.offset) url.searchParams.set("offset", String(args.offset));
    if (args.query) url.searchParams.set("q", args.query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try { response = await fetch(url.toString(), { signal: controller.signal }); } finally { clearTimeout(timer); }
    if (!response.ok) throw new Error(`x402 Bazaar returned HTTP ${response.status}.`);
    const json: any = await response.json();
    if (!Array.isArray(json?.items)) throw new Error("x402 Bazaar returned an unexpected response.");
    const resources = json.items.slice(0, args.limit ?? 10).map((item: any) => {
      const version: 1 | 2 = (item?.x402Version ?? json.x402Version) === 1 ? 1 : 2;
      const accepts = Array.isArray(item?.accepts) ? item.accepts : [];
      return compact({
        resource: text(item?.resource, 2_000),
        type: text(item?.type, 20),
        description: text(item?.metadata?.description ?? accepts[0]?.description, 300),
        lastUpdated: text(item?.lastUpdated, 40),
        x402Version: version,
        accepts: accepts.slice(0, 4).map((raw: unknown, index: number) => {
          const { index: _i, extra: _e, description: _d, mimeType: _m, ...rest } = normalizeRequirement(version, raw, index);
          return rest;
        }),
      });
    });
    return {
      schemaVersion: 1,
      source: "x402 Bazaar",
      observedAt: new Date().toISOString(),
      query: args.query ?? null,
      pagination: json.pagination ?? null,
      resources,
    };
  },
});

/** Host-signed x402: discovery plus parse/plan helpers. No automatic paid fetch. */
export function x402NaniTools(): BaseTool[] {
  return [x402DiscoverResourcesTool, x402ParsePaymentRequiredTool, x402PlanPaymentTool];
}
