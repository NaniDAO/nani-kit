import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client.js";
import { Address, encodeFunctionData, parseEther } from "viem";
import { supportedChains, WETH_ADDRESS, wethAbi } from "./constants.js";

const depositWETHParameters = z.object({
  chainId: z.number().describe("Chain ID to deposit on (e.g. 1 for Ethereum, 8453 for Base, 42161 for Arbitrum)"),
  amount: z.string().describe("Amount of ETH to wrap in human-readable units (e.g. '1.5' for 1.5 ETH)"),
});

const withdrawWETHParameters = z.object({
  chainId: z.number().describe("Chain ID to withdraw on (e.g. 1 for Ethereum, 8453 for Base, 42161 for Arbitrum)"),
  amount: z.string().describe("Amount of WETH to unwrap in human-readable units (e.g. '1.5' for 1.5 WETH)"),
});

const depositWETHChains = supportedChains;
const withdrawWETHChains = supportedChains;

export const intentDepositWETH = createTool({
  name: "depositWETH",
  description: "Wrap native ETH into WETH (Wrapped ETH) by depositing into the WETH contract. You receive an equal amount of WETH, an ERC20 token.",
  supportedChains: depositWETHChains,
  parameters: depositWETHParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof depositWETHParameters>,
  ): Promise<Intent> => {
    const { chainId, amount } = args;
    // Neither of these tools reads the chain, so without this check they
    // returned a signable intent for a chain the client can't reach and
    // only failed at send time, after the user had approved it.
    client.assertChainAvailable(chainId);
    const walletClient = client.getWalletClient(chainId);

    const valueToDeposit = parseEther(amount.toString());

    const data = encodeFunctionData({
      abi: wethAbi,
      functionName: "deposit",
      args: [],
    });

    const ops = [
      {
        target: WETH_ADDRESS[chainId as keyof typeof WETH_ADDRESS] as Address,
        value: valueToDeposit.toString(),
        data: data,
      },
    ];

    if (!walletClient) {
      return {
        intent: `Deposit ${amount} ETH into WETH`,
        ops,
        chain: chainId,
      };
    } else {
      const hash = await client.executeOps(ops, chainId);

      return {
        intent: `Deposit ${amount} ETH into WETH`,
        ops,
        chain: chainId,
        hash,
      };
    }
  },
});

export const intentWithdrawWETH = createTool({
  name: "withdrawWETH",
  description: "Unwrap WETH back to native ETH by withdrawing from the WETH contract. Burns your WETH and returns an equal amount of native ETH.",
  supportedChains: withdrawWETHChains,
  parameters: withdrawWETHParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof withdrawWETHParameters>,
  ): Promise<Intent> => {
    const { chainId, amount } = args;
    client.assertChainAvailable(chainId);

    const walletClient = client.getWalletClient(chainId);

    const valueToWithdraw = parseEther(amount.toString());

    const data = encodeFunctionData({
      abi: wethAbi,
      functionName: "withdraw",
      args: [valueToWithdraw],
    });

    const ops = [
      {
        target: WETH_ADDRESS[chainId as keyof typeof WETH_ADDRESS] as Address,
        value: "0",
        data,
      },
    ];

    if (!walletClient) {
      return {
        intent: `Withdraw ${amount} WETH to native ETH`,
        ops,
        chain: chainId,
      };
    } else {
      const hash = await client.executeOps(ops, chainId);

      return {
        intent: `Withdraw ${amount} WETH to native ETH`,
        ops,
        chain: chainId,
        hash,
      };
    }
  },
});
