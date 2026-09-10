import { z } from "zod";
import { encodeFunctionData, isAddress, parseAbi, type Address, type Hex } from "viem";
import { createTool } from "../client.js";
import { getPositionManagerAddress, supportedChains } from "./constants.js";
import { decodeWord } from "../approvals/observations.js";

const abi = parseAbi(["function balanceOf(address) view returns (uint256)", "function tokenOfOwnerByIndex(address,uint256) view returns (uint256)"]);
export const discoverLPPositionsTool = createTool({
  name: "discoverLPPositions",
  description: "Read up to three owned Uniswap V3 position NFT IDs at a fixed block. Continue with returned block, blockHash and nextOffset. Failed indices remain unknown; fresh ownership checks are required before acting. Excludes staked positions and other managers.",
  parameters: z.object({ owner: z.string().refine(v => isAddress(v, { strict: false })), chainId: z.number().int().positive(), offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
    block: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(), blockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional() }).strict(),
  supportedChains,
  execute: async (client, args) => {
    if (!((args.block === undefined && args.blockHash === undefined && args.offset === 0) || (args.block !== undefined && args.blockHash !== undefined))) throw new Error("Restart discovery or supply the complete page cursor");
    const manager = getPositionManagerAddress(args.chainId), rpc = client.getPublicClient(args.chainId);
    const blockNumber = args.block === undefined ? await rpc.getBlockNumber() : BigInt(args.block);
    const block = `0x${blockNumber.toString(16)}` as Hex;
    async function hash() {
      const header = await rpc.request({ method: "eth_getBlockByNumber", params: [block, false] });
      if (!header || typeof header.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(header.hash) || !header.number || BigInt(header.number) !== blockNumber) throw new Error("Discovery block unavailable");
      return header.hash.toLowerCase();
    }
    const blockHash = await hash();
    if (args.blockHash && args.blockHash.toLowerCase() !== blockHash) throw new Error("Discovery block reorganized; restart discovery");
    async function word(data: Hex) {
      const response = await rpc.call({ to: manager, data, blockNumber });
      return BigInt(decodeWord(response.data));
    }
    const total = await word(encodeFunctionData({ abi, functionName: "balanceOf", args: [args.owner as Address] }));
    if (total > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(args.offset) > total) throw new Error("Unsupported position-page bounds");
    const totalAtBlock = Number(total), end = args.offset + Math.min(3, totalAtBlock - args.offset);
    const tokenIDs: string[] = [], errors: string[] = [];
    for (let i = args.offset; i < end; i++) {
      try {
        const id = (await word(encodeFunctionData({ abi, functionName: "tokenOfOwnerByIndex", args: [args.owner as Address, BigInt(i)] }))).toString();
        if (tokenIDs.includes(id)) throw new Error("Duplicate position returned");
        tokenIDs.push(id);
      } catch { errors.push(`Index ${i}: position ID unavailable or duplicate; not an empty index.`); }
    }
    if (await hash() !== blockHash) throw new Error("Discovery block changed; restart discovery");
    return { schemaVersion: 1, owner: args.owner.toLowerCase(), chainId: args.chainId, manager: manager.toLowerCase(), block, blockHash,
      totalAtBlock, offset: args.offset, nextOffset: end < totalAtBlock ? end : null, tokenIDs, errors, observedAt: new Date().toISOString(),
      coverage: "One page of at most three NFT IDs. Failed indices remain unknown. Fresh ownership and details checks required. Other managers, staked positions and protocols excluded." };
  },
});
