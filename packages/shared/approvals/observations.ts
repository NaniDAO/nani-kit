import { z } from "zod";
import { encodeFunctionData, erc20Abi, erc721Abi, isAddress, type Address, type Hex } from "viem";
import { createTool, type AgentekClient } from "../client.js";

const address = z.string().refine(value => isAddress(value, { strict: false }), "Invalid address");
const chainId = z.number().int().positive();
const pair = z.object({ token: address, spender: address }).strict();
export function decodeWord(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("Unreadable ABI word; not zero");
  return value.toLowerCase() as Hex;
}
export function decodeBoolean(value: unknown): boolean {
  const word = BigInt(decodeWord(value));
  if (word !== 0n && word !== 1n) throw new Error("Unreadable boolean; not false");
  return word === 1n;
}
export async function observeAllowance(client: AgentekClient, args: { owner: string; token: string; spender: string; chainId: number }) {
  const rpc = client.getPublicClient(args.chainId);
  const block = await rpc.getBlockNumber();
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [args.owner as Address, args.spender as Address] });
  const response = await rpc.call({ to: args.token as Address, data, blockNumber: block });
  const allowanceHex = decodeWord(response.data);
  return {
    schemaVersion: 1, owner: args.owner.toLowerCase(), token: args.token.toLowerCase(), spender: args.spender.toLowerCase(),
    chainId: args.chainId, block: `0x${block.toString(16)}`, observedAt: new Date().toISOString(), allowanceHex,
    active: BigInt(allowanceHex) !== 0n, unlimited: BigInt(allowanceHex) === (1n << 256n) - 1n,
    coverage: "One ERC20 pair only. NFT operators, Permit2 internals, sessions and guardians are not checked.",
  };
}
export const observeTokenPermissionTool = createTool({
  name: "observeTokenPermission", description: "Read one exact ERC20 allowance at an observed block. Unknown is never zero. Read-only; no discovery.",
  parameters: pair.extend({ owner: address, chainId }).strict(),
  execute: observeAllowance,
});
export const observeNFTOperatorTool = createTool({
  name: "observeNFTOperator", description: "Read one collection/operator isApprovedForAll value. No operator discovery, collection verification or individual NFT approval coverage.",
  parameters: z.object({ owner: address, collection: address, operator: address, chainId }).strict(),
  execute: async (client, args) => {
    const rpc = client.getPublicClient(args.chainId), block = await rpc.getBlockNumber();
    const data = encodeFunctionData({ abi: erc721Abi, functionName: "isApprovedForAll", args: [args.owner as Address, args.operator as Address] });
    const response = await rpc.call({ to: args.collection as Address, data, blockNumber: block });
    return { schemaVersion: 1, owner: args.owner.toLowerCase(), collection: args.collection.toLowerCase(), operatorAddress: args.operator.toLowerCase(),
      chainId: args.chainId, block: `0x${block.toString(16)}`, observedAt: new Date().toISOString(), approved: decodeBoolean(response.data) };
  },
});
export const planSelectedRevocationsTool = createTool({
  name: "planSelectedRevocations", description: "Prepare ONLY unsigned approve(spender,0) calls for 1–8 explicitly chosen pairs. Never signs even with a wallet-enabled client. Unknown/zero/duplicate pairs reject the entire plan. Human approval required.",
  parameters: z.object({ owner: address, chainId, pairs: z.array(pair).min(1).max(8) }).strict(),
  execute: async (client, args) => {
    const keys = args.pairs.map(p => `${p.token.toLowerCase()}:${p.spender.toLowerCase()}`);
    if (new Set(keys).size !== keys.length) throw new Error("Duplicate permission pairs");
    const observations = [];
    for (const selected of args.pairs) {
      const observation = await observeAllowance(client, { ...selected, owner: args.owner, chainId: args.chainId });
      if (!observation.active) throw new Error("Selected allowance is zero; review selection again");
      observations.push(observation);
    }
    return { schemaVersion: 1, owner: args.owner.toLowerCase(), chain: args.chainId, observations,
      ops: args.pairs.map(p => ({ target: p.token, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [p.spender as Address, 0n] }) })),
      warning: "Revocation can break app access. Submission is not confirmation; re-read each allowance after its receipt.",
    };
  },
});

// These tools deliberately use only the caller's configured public RPC client.
// Do not add signing, provider fallbacks, background sweeps or wallet discovery.
// Host applications own persistence, account binding and approval policy.
// Versions are explicit so hosts reject incompatible observations.
// Exact amounts remain strings across JSON/JavaScriptCore boundaries.
// No legacy scanner failure is converted into a clean or empty result here.
// Existing scanner tools remain available for backward compatibility.
// Consumers must not infer complete wallet authority from these narrow reads.
