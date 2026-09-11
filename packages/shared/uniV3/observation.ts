import { z } from "zod";
import { isAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import { createTool } from "../client.js";
import { getPositionManagerAddress, supportedChains } from "./constants.js";

export function signedTick(word: string): number {
  if (!/^[0-9a-fA-F]{64}$/.test(word)) throw new Error("Unreadable tick");
  const low = Number(BigInt("0x" + word.slice(-6))), negative = (low & 0x800000) !== 0;
  if (word.slice(0, 58).toLowerCase() !== (negative ? "f" : "0").repeat(58)) throw new Error("Noncanonical tick");
  const tick = negative ? low - 0x1000000 : low;
  if (tick < -887272 || tick > 887272) throw new Error("Tick out of bounds");
  return tick;
}
function address(word: string): Address {
  if (!/^0{24}[0-9a-f]{40}$/.test(word) || BigInt("0x" + word) === 0n) throw new Error("Invalid contract address");
  return ("0x" + word.slice(-40)) as Address;
}
export const observeLPPositionTool = createTool({
  name: "observeLPPosition",
  description: "Read an explicitly requested owned Uniswap V3 NFT and its pool range at one checked block. Range failure stays unknown alongside valid details. No accrued-fee estimate, executable withdrawal amount or signing. Code and pool identity checks do not verify implementation safety.",
  parameters: z.object({ owner: z.string().refine(v => isAddress(v, { strict: false })), chainId: z.number().int().positive(), tokenId: z.string().regex(/^[0-9]+$/).max(78).refine(v => BigInt(v) < (1n << 256n)) }).strict(),
  supportedChains,
  execute: async (client, args) => {
    const manager = getPositionManagerAddress(args.chainId), rpc = client.getPublicClient(args.chainId);
    const height = await rpc.getBlockNumber(), block = `0x${height.toString(16)}` as Hex;
    async function blockHash() {
      const header = await rpc.request({ method: "eth_getBlockByNumber", params: [block, false] });
      if (!header?.hash || !/^0x[0-9a-fA-F]{64}$/.test(header.hash) || !header.number || BigInt(header.number) !== height) throw new Error("Observation block unavailable");
      return header.hash.toLowerCase();
    }
    const hash = await blockHash();
    const code = await rpc.getCode({ address: manager, blockNumber: height });
    if (!code || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw new Error("Position manager unavailable");
    async function call(target: Address, signature: string, args: string, count: number) {
      const data = (keccak256(toBytes(signature)).slice(0, 10) + args) as Hex;
      const result = await rpc.call({ to: target, data, blockNumber: height });
      if (!result.data || !new RegExp(`^0x[0-9a-fA-F]{${count * 64}}$`).test(result.data)) throw new Error("Incomplete position or pool evidence");
      return result.data.slice(2).toLowerCase().match(/.{64}/g)!;
    }
    const id = BigInt(args.tokenId), idWord = id.toString(16).padStart(64, "0");
    const owner = address((await call(manager, "ownerOf(uint256)", idWord, 1))[0]!);
    if (owner !== args.owner.toLowerCase()) throw new Error("Position is not owned by this account");
    const fields = await call(manager, "positions(uint256)", idWord, 12);
    const token0 = address(fields[2]!), token1 = address(fields[3]!);
    const rawFee = BigInt("0x" + fields[4]!);
    const tickLower = signedTick(fields[5]!), tickUpper = signedTick(fields[6]!);
    if (rawFee <= 0n || rawFee >= 1000000n || tickLower >= tickUpper || token0 === token1) throw new Error("Invalid position details");
    for (const index of [7, 10, 11]) if (BigInt("0x" + fields[index]!) >= (1n << 128n)) throw new Error("Noncanonical position quantity");
    const liquidity = BigInt("0x" + fields[7]!).toString();
    let range: { pool: string; tick: number; status: string } | null = null, rangeError: string | null = null;
    try {
      const factory = address((await call(manager, "factory()", "", 1))[0]!);
      const pool = address((await call(factory, "getPool(address,address,uint24)", fields[2]! + fields[3]! + fields[4]!, 1))[0]!);
      const first = address((await call(pool, "token0()", "", 1))[0]!);
      const second = address((await call(pool, "token1()", "", 1))[0]!);
      const fee = (await call(pool, "fee()", "", 1))[0]!;
      const poolFactory = address((await call(pool, "factory()", "", 1))[0]!);
      if (first !== token0 || second !== token1 || fee !== fields[4] || poolFactory !== factory) throw new Error("Pool identity mismatch");
      const slot = await call(pool, "slot0()", "", 7);
      const price = BigInt("0x" + slot[0]!);
      if (price === 0n || price >= (1n << 160n) || BigInt("0x" + slot[6]!) !== 1n) throw new Error("Pool is uninitialized or locked");
      const tick = signedTick(slot[1]!);
      range = { pool, tick, status: liquidity === "0" ? "No active liquidity" : tick >= tickLower && tick < tickUpper ? "In range" : "Out of range" };
    } catch { rangeError = "Pool range unavailable or inconsistent; not an in-range result. Retry the observation."; }
    if (await blockHash() !== hash) throw new Error("Observation block changed; retry");
    return { schemaVersion: 1, owner, chainId: args.chainId, manager: manager.toLowerCase(), tokenID: id.toString(), block, blockHash: hash, observedAt: new Date().toISOString(),
      token0, token1, fee: Number(rawFee), tickLower, tickUpper, liquidity, tokensOwed0: BigInt("0x" + fields[10]!).toString(), tokensOwed1: BigInt("0x" + fields[11]!).toString(), range, rangeError,
      coverage: "One owned Uniswap V3 NFT only. Owed fields exclude uncollected fee growth; range is not profitability or executable liquidity. Pool identity is not implementation verification." };
  },
});
