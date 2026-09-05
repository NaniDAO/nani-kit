import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client.js";
import {
  Address,
  encodeFunctionData,
  erc20Abi,
  maxUint256,
  parseUnits,
  PublicClient,
} from "viem";
import { erc20Chains } from "./constants.js";

const intentApproveParameters = z.object({
  token: z.string().describe("The token address"),
  amount: z.string().describe('The amount to approve. Use "max" for unlimited approval (type(uint256).max)'),
  spender: z.string().describe("The spender address to approve"),
  chainId: z.number().optional().describe("Optional specific chain to use"),
});

export const ETH_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;

const getTokenDecimals = async (
  publicClient: PublicClient,
  token: Address,
): Promise<number> => {
  if (token == ETH_ADDRESS) {
    return 18;
  } else {
    return await publicClient.readContract({
      abi: erc20Abi,
      functionName: "decimals",
      address: token,
    });
  }
};

export const intentApproveTool = createTool({
  name: "intentApprove",
  description: 'Creates an intent to approve token spending. Supports "max" for unlimited approval.',
  supportedChains: erc20Chains,
  parameters: intentApproveParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentApproveParameters>,
  ): Promise<Intent> => {
    const { token, amount, spender, chainId } = args;
    const chains = client.filterSupportedChains(erc20Chains, chainId);
    const from = await client.getAddress();

    if (token === ETH_ADDRESS) {
      throw new Error("Cannot approve ETH, only ERC20 tokens");
    }

    const chainsInfo = (
      await Promise.all(
        chains.map(async (chain) => {
          try {
            const isMax = amount.toLowerCase() === "max";
            const publicClient = client.getPublicClient(chain.id);
            // Always read decimals, even for "max" where the value isn't
            // needed: this call is what proves the token exists on this chain,
            // and skipping it left every chain a candidate. The winner was then
            // picked on gas price alone, so `max` approvals were built against
            // a mainnet token address on whichever chain was cheapest.
            const decimals = await getTokenDecimals(publicClient, token as Address);

            const amountBigInt = isMax ? maxUint256 : parseUnits(amount, decimals);

            return {
              chain,
              amount: amountBigInt,
              decimals,
            };
          } catch (error) {
            return undefined;
          }
        }),
      )
    ).filter(
      (chainInfo): chainInfo is NonNullable<typeof chainInfo> =>
        chainInfo !== undefined,
    );

    let executionChain;
    if (chainsInfo.length === 0) {
      throw new Error("No supported chains found with valid token information");
    } else {
      executionChain = await Promise.all(
        chainsInfo.map(async (chainInfo) => {
          const publicClient = client.getPublicClient(chainInfo.chain.id);
          const gasPrice = await publicClient.getGasPrice();
          return {
            ...chainInfo,
            gasPrice,
          };
        }),
      ).then((chains) =>
        chains.reduce((cheapest, current) =>
          current.gasPrice < cheapest.gasPrice ? current : cheapest,
        ),
      );
    }

    const walletClient = client.getWalletClient(executionChain.chain.id);

    const ops = [
      {
        target: token as Address,
        value: "0",
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [spender as Address, executionChain.amount],
        }),
      },
    ];

    const displayAmount = amount.toLowerCase() === "max" ? "max (unlimited)" : amount.toString();

    if (!walletClient) {
      return {
        intent: `approve ${displayAmount} ${token} for spender ${spender}`,
        ops,
        chain: executionChain.chain.id,
      };
    } else {
      const hash = await client.executeOps(ops, executionChain.chain.id);

      return {
        intent: `Approve ${displayAmount} ${token} from ${from} for spender ${spender}`,
        ops,
        chain: executionChain.chain.id,
        hash: hash,
      };
    }
  },
});
