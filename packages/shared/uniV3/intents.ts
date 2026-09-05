import { z } from "zod";
import { createTool } from "../client.js";
import { getPositionManagerAddress, supportedChains } from "./constants.js";

import { Address, encodeFunctionData, erc721Abi, maxUint128 } from "viem";
import { nonfungiblePositionManagerAbi } from "./constants.js";

/**
 * Percentage slippage -> basis points, as a bigint.
 *
 * `BigInt(percent * 100)` threw a RangeError for any tolerance with more than
 * two decimal places (0.155 -> BigInt(15.5)), so rounding happens first.
 */
const toBps = (percent: number): bigint =>
  BigInt(Math.max(0, Math.min(10_000, Math.round(percent * 100))));

/** Apply a slippage tolerance downwards, e.g. 0.5% of 1000 -> 995. */
const applySlippage = (amount: bigint, percent: number): bigint =>
  (amount * (10_000n - toBps(percent))) / 10_000n;

/**
 * Ask the position manager what a withdrawal would actually return, so the
 * slippage floors can be set in token units rather than liquidity units.
 * Simulated as the position's owner, since decreaseLiquidity is owner-gated.
 */
async function simulateDecrease(
  client: Parameters<Parameters<typeof createTool>[0]["execute"]>[0],
  chainId: number,
  tokenId: bigint,
  liquidity: bigint,
  deadline: bigint,
): Promise<[bigint, bigint]> {
  const publicClient = client.getPublicClient(chainId);
  const positionManager = getPositionManagerAddress(chainId);

  const owner = (await publicClient.readContract({
    address: positionManager,
    abi: erc721Abi,
    functionName: "ownerOf",
    args: [tokenId],
  })) as Address;

  const { result } = await publicClient.simulateContract({
    address: positionManager,
    abi: nonfungiblePositionManagerAbi,
    functionName: "decreaseLiquidity",
    args: [{ tokenId, liquidity, amount0Min: 0n, amount1Min: 0n, deadline }],
    account: owner,
  });

  return [BigInt(result[0]), BigInt(result[1])];
}

const intentMintPosition = createTool({
  name: "intentMintPosition",
  description: "Creates a new Uniswap V3 liquidity position by minting an LP NFT. Requires both tokens to be approved for the Position Manager contract beforehand.",
  supportedChains,
  parameters: z.object({
    token0: z.string().describe("Address of the first token in the pair (0x...). Must be the lower-sorted address."),
    token1: z.string().describe("Address of the second token in the pair (0x...). Must be the higher-sorted address."),
    fee: z.number().describe("Pool fee tier in hundredths of a bip (e.g. 500 for 0.05%, 3000 for 0.3%, 10000 for 1%)"),
    tickLower: z.number().describe("Lower tick boundary of the position's price range"),
    tickUpper: z.number().describe("Upper tick boundary of the position's price range"),
    amount0Desired: z.string().describe("Desired amount of token0 to deposit in wei as a decimal string"),
    amount1Desired: z.string().describe("Desired amount of token1 to deposit in wei as a decimal string"),
    slippageTolerance: z.number().default(0.5).describe("Max slippage as a percentage (e.g. 0.5 for 0.5%). Default: 0.5"),
    recipient: z.string().optional().describe("Address to receive the LP NFT (0x...). Defaults to the connected wallet."),
    deadline: z.number().optional().describe("Unix timestamp deadline for the transaction. Defaults to 20 minutes from now."),
    chainId: z.number().describe("Chain ID where the pool exists (e.g. 1, 8453, 42161)"),
  }),
  execute: async (client, args) => {
    const user = await client.getAddress();
    const deadline = args.deadline || Math.floor(Date.now() / 1000) + 1200;

    const amount0Desired = BigInt(args.amount0Desired);
    const amount1Desired = BigInt(args.amount1Desired);
    const amount0Min = applySlippage(amount0Desired, args.slippageTolerance);
    const amount1Min = applySlippage(amount1Desired, args.slippageTolerance);

    const data = encodeFunctionData({
      abi: nonfungiblePositionManagerAbi,
      functionName: "mint",
      args: [
        {
          token0: args.token0 as Address,
          token1: args.token1 as Address,
          fee: args.fee,
          tickLower: args.tickLower,
          tickUpper: args.tickUpper,
          amount0Desired,
          amount1Desired,
          amount0Min,
          amount1Min,
          recipient: (args.recipient as Address) || user,
          deadline: BigInt(deadline),
        },
      ],
    });

    const ops = [
      {
        target: getPositionManagerAddress(args.chainId),
        value: "0",
        data,
      },
    ];

    const walletClient = client.getWalletClient(args.chainId);
    if (!walletClient) {
      return {
        intent: `Mint Uniswap V3 position for ${args.token0}/${args.token1}`,
        ops,
        chain: args.chainId,
      };
    }

    const hash = await client.executeOps(ops, args.chainId);

    return {
      intent: `Mint Uniswap V3 position for ${args.token0}/${args.token1}`,
      ops,
      chain: args.chainId,
      hash,
    };
  },
});

const intentIncreaseLiquidity = createTool({
  name: "intentIncreaseLiquidity",
  description: "Adds more liquidity to an existing Uniswap V3 LP position identified by its NFT token ID.",
  supportedChains,
  parameters: z.object({
    tokenId: z.string().describe("The NFT token ID of the existing LP position"),
    amount0Desired: z.string().describe("Desired amount of token0 to add in wei as a decimal string"),
    amount1Desired: z.string().describe("Desired amount of token1 to add in wei as a decimal string"),
    slippageTolerance: z.number().default(0.5).describe("Max slippage as a percentage (e.g. 0.5 for 0.5%). Default: 0.5"),
    deadline: z.number().optional().describe("Unix timestamp deadline for the transaction. Defaults to 20 minutes from now."),
    chainId: z.number().describe("Chain ID where the position exists (e.g. 1, 8453, 42161)"),
  }),
  execute: async (client, args) => {
    const deadline = args.deadline || Math.floor(Date.now() / 1000) + 1200;
    const amount0Desired = BigInt(args.amount0Desired);
    const amount1Desired = BigInt(args.amount1Desired);
    const amount0Min = applySlippage(amount0Desired, args.slippageTolerance);
    const amount1Min = applySlippage(amount1Desired, args.slippageTolerance);

    const data = encodeFunctionData({
      abi: nonfungiblePositionManagerAbi,
      functionName: "increaseLiquidity",
      args: [
        {
          tokenId: BigInt(args.tokenId),
          amount0Desired,
          amount1Desired,
          amount0Min,
          amount1Min,
          deadline: BigInt(deadline),
        },
      ],
    });

    const ops = [
      {
        target: getPositionManagerAddress(args.chainId),
        value: "0",
        data,
      },
    ];

    const walletClient = client.getWalletClient(args.chainId);
    if (!walletClient) {
      return {
        intent: `Increase liquidity for position #${args.tokenId}`,
        ops,
        chain: args.chainId,
      };
    }

    const hash = await client.executeOps(ops, args.chainId);

    return {
      intent: `Increase liquidity for position #${args.tokenId}`,
      ops,
      chain: args.chainId,
      hash,
    };
  },
});

const intentDecreaseLiquidity = createTool({
  name: "intentDecreaseLiquidity",
  description: "Removes liquidity from a Uniswap V3 LP position. The removed tokens are not automatically collected — use intentCollectFees afterwards to withdraw them.",
  supportedChains,
  parameters: z.object({
    tokenId: z.string().describe("The NFT token ID of the LP position to remove liquidity from"),
    liquidity: z.string().describe("Amount of liquidity to remove as a decimal string (get this from getPositionDetails)"),
    slippageTolerance: z.number().default(0.5).describe("Max slippage as a percentage (e.g. 0.5 for 0.5%). Default: 0.5"),
    amount0Min: z.string().optional().describe("Minimum amount of token0 to receive, in wei as a decimal string. Omit to derive it from a simulation of the withdrawal minus slippageTolerance."),
    amount1Min: z.string().optional().describe("Minimum amount of token1 to receive, in wei as a decimal string. Omit to derive it from a simulation of the withdrawal minus slippageTolerance."),
    deadline: z.number().optional().describe("Unix timestamp deadline for the transaction. Defaults to 20 minutes from now."),
    chainId: z.number().describe("Chain ID where the position exists (e.g. 1, 8453, 42161)"),
  }),
  execute: async (client, args) => {
    const deadline = args.deadline || Math.floor(Date.now() / 1000) + 1200;
    const liquidity = BigInt(args.liquidity);

    // amount0Min/amount1Min are *token* amounts the position must return, in
    // each token's own decimals. They used to be filled with a fraction of the
    // liquidity L — a different quantity in a different unit, which for most
    // pools reverts on the protocol's own slippage check and where it doesn't,
    // protects nothing. Simulating the withdrawal gives the real amounts to
    // apply the tolerance to.
    let amount0Min: bigint;
    let amount1Min: bigint;

    if (args.amount0Min !== undefined && args.amount1Min !== undefined) {
      amount0Min = BigInt(args.amount0Min);
      amount1Min = BigInt(args.amount1Min);
    } else {
      const [expected0, expected1] = await simulateDecrease(
        client,
        args.chainId,
        BigInt(args.tokenId),
        liquidity,
        BigInt(deadline),
      );
      amount0Min =
        args.amount0Min !== undefined
          ? BigInt(args.amount0Min)
          : applySlippage(expected0, args.slippageTolerance);
      amount1Min =
        args.amount1Min !== undefined
          ? BigInt(args.amount1Min)
          : applySlippage(expected1, args.slippageTolerance);
    }

    const data = encodeFunctionData({
      abi: nonfungiblePositionManagerAbi,
      functionName: "decreaseLiquidity",
      args: [
        {
          tokenId: BigInt(args.tokenId),
          liquidity,
          amount0Min,
          amount1Min,
          deadline: BigInt(deadline),
        },
      ],
    });

    const ops = [
      {
        target: getPositionManagerAddress(args.chainId),
        value: "0",
        data,
      },
    ];

    const walletClient = client.getWalletClient(args.chainId);
    if (!walletClient) {
      return {
        intent: `Decrease liquidity for position #${args.tokenId}`,
        ops,
        chain: args.chainId,
      };
    }

    const hash = await client.executeOps(ops, args.chainId);

    return {
      intent: `Decrease liquidity for position #${args.tokenId}`,
      ops,
      chain: args.chainId,
      hash,
    };
  },
});

const intentCollectFees = createTool({
  name: "intentCollectFees",
  description: "Collects all accumulated trading fees and any tokens from decreased liquidity for a Uniswap V3 LP position.",
  supportedChains,
  parameters: z.object({
    tokenId: z.string().describe("The NFT token ID of the LP position to collect fees from"),
    recipient: z.string().optional().describe("Address to receive the collected tokens (0x...). Defaults to the connected wallet."),
    chainId: z.number().describe("Chain ID where the position exists (e.g. 1, 8453, 42161)"),
  }),
  execute: async (client, args) => {
    const user = await client.getAddress();
    const data = encodeFunctionData({
      abi: nonfungiblePositionManagerAbi,
      functionName: "collect",
      args: [
        {
          tokenId: BigInt(args.tokenId),
          recipient: (args.recipient as Address) || user,
          amount0Max: maxUint128,
          amount1Max: maxUint128,
        },
      ],
    });

    const ops = [
      {
        target: getPositionManagerAddress(args.chainId),
        value: "0",
        data,
      },
    ];

    const walletClient = client.getWalletClient(args.chainId);
    if (!walletClient) {
      return {
        intent: `Collect fees from position #${args.tokenId}`,
        ops,
        chain: args.chainId,
      };
    }

    const hash = await client.executeOps(ops, args.chainId);

    return {
      intent: `Collect fees from position #${args.tokenId}`,
      ops,
      chain: args.chainId,
      hash,
    };
  },
});

const intentTransferPosition = createTool({
  name: "intentTransferPosition",
  description: "Transfers ownership of a Uniswap V3 LP NFT to another address using safeTransferFrom.",
  supportedChains,
  parameters: z.object({
    tokenId: z.string().describe("The NFT token ID of the LP position to transfer"),
    to: z.string().describe("The recipient address to transfer the LP NFT to (0x...)"),
    chainId: z.number().describe("Chain ID where the position exists (e.g. 1, 8453, 42161)"),
  }),
  execute: async (client, args) => {
    const data = encodeFunctionData({
      abi: erc721Abi,
      functionName: "safeTransferFrom",
      args: [
        await client.getAddress(),
        args.to as Address,
        BigInt(args.tokenId),
      ],
    });

    const ops = [
      {
        target: getPositionManagerAddress(args.chainId),
        value: "0",
        data,
      },
    ];

    const walletClient = client.getWalletClient(args.chainId);
    if (!walletClient) {
      return {
        intent: `Transfer position #${args.tokenId} to ${args.to}`,
        ops,
        chain: args.chainId,
      };
    }

    const hash = await client.executeOps(ops, args.chainId);

    return {
      intent: `Transfer position #${args.tokenId} to ${args.to}`,
      ops,
      chain: args.chainId,
      hash,
    };
  },
});

export {
  intentMintPosition,
  intentIncreaseLiquidity,
  intentDecreaseLiquidity,
  intentCollectFees,
  intentTransferPosition,
};
