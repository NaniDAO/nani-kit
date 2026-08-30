import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client";
import { arbitrum, base, mainnet, sepolia } from "viem/chains";
import {
  Address,
  encodeFunctionData,
  parseUnits,
  PublicClient,
} from "viem";

const DETH_ADDRESS = "0x0000000000002E1E69a6ccE62A7563A2E14987f4" as Address;

const dethAbi = [
  {
    inputs: [{ name: "to", type: "address" }],
    name: "depositTo",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ name: "transferId", type: "bytes32" }],
    name: "reverse",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// DETH Deposit Tool
const intentDepositDETHParameters = z.object({
  amount: z.string().describe("The amount of ETH to deposit"),
  to: z.string().describe("The recipient address or ENS"),
  chainId: z.number().optional().describe("Optional specific chain to use"),
});

const supportedChains = [mainnet, arbitrum, base, sepolia];

export const intentDepositDETHTool = createTool({
  name: "intentDepositDETH",
  description: "Creates an intent to deposit ETH and receive DETH",
  supportedChains,
  parameters: intentDepositDETHParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentDepositDETHParameters>,
  ): Promise<Intent> => {
    const { amount, to, chainId } = args;
    const chains = client.filterSupportedChains(supportedChains, chainId);
    const from = await client.getAddress();

    const chainsWithBalance = (
      await Promise.all(
        chains.map(async (chain) => {
          const publicClient = client.getPublicClient(chain.id);
          const balance = await publicClient.getBalance({ address: from });
          const amountBigInt = parseUnits(amount, 18); // ETH always has 18 decimals

          if (balance >= amountBigInt) {
            return {
              chain,
              balance,
              amount: amountBigInt,
            };
          }
          return null;
        }),
      )
    ).filter((chain): chain is NonNullable<typeof chain> => chain !== null);

    if (chainsWithBalance.length === 0) {
      throw new Error(
        `${from} doesn't have enough ETH balance on any of the supported chains`,
      );
    }

    const cheapestChain = await Promise.all(
      chainsWithBalance.map(async (chainInfo) => {
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

    const walletClient = client.getWalletClient(cheapestChain.chain.id);

    const ops = [{
      target: DETH_ADDRESS,
      value: cheapestChain.amount.toString(),
      data: encodeFunctionData({
        abi: dethAbi,
        functionName: "depositTo",
        args: [to as Address],
      }),
    }];

    if (!walletClient) {
      return {
        intent: `deposit ${amount} ETH to receive DETH for ${to}`,
        ops,
        chain: cheapestChain.chain.id,
      };
    } else {
      const hash = await walletClient.sendTransaction({
        to: ops[0].target,
        value: ops[0].value,
        data: ops[0].data,
      });

      return {
        intent: `deposit ${amount} ETH to receive DETH for ${to}`,
        ops,
        chain: cheapestChain.chain.id,
        hash,
      };
    }
  },
});

// DETH Reverse Tool
const intentReverseDETHParameters = z.object({
  transferId: z.string().describe("The transfer ID to reverse"),
  chainId: z.number().optional().describe("Optional specific chain to use"),
});

export const intentReverseDETHTool = createTool({
  name: "intentReverseDETH",
  description: "Creates an intent to reverse a DETH transfer",
  supportedChains,
  parameters: intentReverseDETHParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentReverseDETHParameters>,
  ): Promise<Intent> => {
    const { transferId, chainId } = args;
    const chains = client.filterSupportedChains(supportedChains, chainId);
    const from = await client.getAddress();

    const cheapestChain = await Promise.all(
      chains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        const gasPrice = await publicClient.getGasPrice();
        return {
          chain,
          gasPrice,
        };
      }),
    ).then((chains) =>
      chains.reduce((cheapest, current) =>
        current.gasPrice < cheapest.gasPrice ? current : cheapest,
      ),
    );

    const walletClient = client.getWalletClient(cheapestChain.chain.id);

    const ops = [{
      target: DETH_ADDRESS,
      value: "0",
      data: encodeFunctionData({
        abi: dethAbi,
        functionName: "reverse",
        args: [transferId as `0x${string}`],
      }),
    }];

    if (!walletClient) {
      return {
        intent: `reverse DETH transfer with ID ${transferId}`,
        ops,
        chain: cheapestChain.chain.id,
      };
    } else {
      const hash = await walletClient.sendTransaction({
        to: ops[0].target,
        value: ops[0].value,
        data: ops[0].data,
      });

      return {
        intent: `reverse DETH transfer with ID ${transferId}`,
        ops,
        chain: cheapestChain.chain.id,
        hash,
      };
    }
  },
});
