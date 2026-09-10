import { z } from "zod";
import { encodeFunctionData, formatUnits, isAddress, type Address } from "viem";
import { createTool } from "../client.js";
import { aavePoolAbi, getAavePoolAddress, supportedChains } from "./constants.js";

export const observeAaveAccountTool = createTool({
  name: "observeAaveAccount",
  description: "Exact read-only Aave V3 account aggregates at one block. Not a supplied-asset breakdown, executable withdrawal amount or portfolio total. A failed read is unknown, never zero.",
  parameters: z.object({ owner: z.string().refine(v => isAddress(v, { strict: false })), chainId: z.number().int().positive() }).strict(),
  supportedChains,
  execute: async (client, args) => {
    const pool = getAavePoolAddress(args.chainId), rpc = client.getPublicClient(args.chainId);
    const block = await rpc.getBlockNumber();
    const code = await rpc.getCode({ address: pool, blockNumber: block });
    if (!code || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw new Error("Configured Aave pool is unavailable");
    const data = encodeFunctionData({ abi: aavePoolAbi, functionName: "getUserAccountData", args: [args.owner as Address] });
    const response = await rpc.call({ to: pool, data, blockNumber: block });
    if (!response.data || !/^0x[0-9a-fA-F]{384}$/.test(response.data)) throw new Error("Incomplete Aave account evidence; not zero");
    const values = Array.from({ length: 6 }, (_, i) => BigInt("0x" + response.data!.slice(2 + i * 64, 66 + i * 64)));
    const [collateral, debt, , , , health] = values as [bigint, bigint, bigint, bigint, bigint, bigint];
    const fields = ["totalCollateralBase", "totalDebtBase", "availableBorrowsBase", "currentLiquidationThreshold", "ltv", "healthFactor"];
    return { schemaVersion: 1, owner: args.owner.toLowerCase(), chainId: args.chainId, pool: pool.toLowerCase(), block: `0x${block.toString(16)}`, observedAt: new Date().toISOString(),
      collateral: formatUnits(collateral, 8), debt: formatUnits(debt, 8), healthFactor: debt === 0n ? "Not applicable · no debt reported" : formatUnits(health, 18),
      needsAttention: debt !== 0n && health <= 1000000000000000000n,
      rawData: Object.fromEntries(fields.map((field, i) => [field, values[i]!.toString()])),
      coverage: "Configured Aave V3 account aggregates only. Do not add to wallet receipt-token balances. Code presence is not implementation verification." };
  },
});
