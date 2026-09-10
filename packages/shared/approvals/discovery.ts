import { z } from "zod";
import { isAddress, keccak256, toBytes } from "viem";
import { createTool } from "../client.js";
import { decodeWord, observeAllowance } from "./observations.js";

const topic = keccak256(toBytes("Approval(address,address,uint256)"));
const quantity = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) throw new Error("Invalid block quantity");
  return BigInt(value);
};
export const discoverTokenPermissionsTool = createTool({
  name: "discoverTokenPermissions",
  description: "Partial ERC20 approval discovery: one 2000-block window, at most 4096 logs, 64 pairs and 24 live allowance reads. Empty is not proof of no permissions. Read-only; never signs.",
  parameters: z.object({ owner: z.string().refine(v => isAddress(v, { strict: false })), chainId: z.number().int().positive(), through: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).strict(),
  execute: async (client, args) => {
    const rpc = client.getPublicClient(args.chainId);
    const head = await rpc.getBlockNumber();
    const end = args.through === undefined ? head : BigInt(args.through);
    if (end > head || end > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Invalid scan end");
    const start = end > 1999n ? end - 1999n : 0n;
    const ownerTopic = "0x" + "0".repeat(24) + args.owner.slice(2).toLowerCase();
    const logs = await rpc.request({ method: "eth_getLogs", params: [{ fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, topics: [topic, ownerTopic] }] });
    if (!Array.isArray(logs)) throw new Error("Approval history unavailable; not an empty scan");
    const pairs: { token: string; spender: string }[] = [], seen = new Set<string>();
    let ignoredLogs = 0, candidateLimitReached = logs.length > 4096;
    for (const log of logs.slice(0, 4096)) {
      try {
        if (!log || log.removed === true || !isAddress(log.address, { strict: false }) || !Array.isArray(log.topics) || log.topics.length !== 3 || log.topics[0]?.toLowerCase() !== topic || log.topics[1]?.toLowerCase() !== ownerTopic || !/^0x0{24}[0-9a-fA-F]{40}$/.test(log.topics[2] ?? "")) throw new Error("Invalid event");
        decodeWord(log.data);
        const block = quantity(log.blockNumber);
        if (block < start || block > end) throw new Error("Out of range event");
        const pair = { token: log.address.toLowerCase(), spender: "0x" + log.topics[2]!.slice(-40).toLowerCase() };
        const key = `${pair.token}:${pair.spender}`;
        if (seen.has(key)) continue;
        if (pairs.length === 64) { candidateLimitReached = true; continue; }
        seen.add(key); pairs.push(pair);
      } catch { ignoredLogs++; }
    }
    const entries = [];
    for (const [index, pair] of pairs.entries()) {
      if (index >= 24) { entries.push({ pair, allowance: null, error: "Not checked: per-scan allowance limit reached." }); continue; }
      try {
        entries.push({ pair, allowance: await observeAllowance(client, { ...args, ...pair }), error: null });
      } catch { entries.push({ pair, allowance: null, error: "Allowance unavailable; not zero. Check this pair again." }); }
    }
    return { schemaVersion: 1, owner: args.owner.toLowerCase(), chainId: args.chainId, fromBlock: Number(start), toBlock: Number(end), observedAt: new Date().toISOString(), entries, ignoredLogs, candidateLimitReached,
      coverage: "Partial discovery only. Older approvals, omitted provider results, nonstandard events, NFT operators, Permit2 internals, sessions and guardians are not covered. Empty results do not mean no permissions." };
  },
});
