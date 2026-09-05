import { createTool, Op } from "../client.js";
import { z } from "zod";
import { CoinchanAbi, CoinchanAddress, supportedChains } from "./constants.js";
import { Address, encodeFunctionData, Hex, parseEther } from "viem";
import { addressSchema } from "../utils.js";

export const intentCoinchanMake = createTool({
  name: "intentCoinchanMake",
  description: "Create a new Coinchan token, mint supplies and add initial liquidity via ZAMM",
  supportedChains,
  parameters: z.object({
    chainId: z.number().describe("Chain ID for execution"),
    name: z.string().describe("Name of the token"),
    symbol: z.string().describe("Symbol of the token"),
    tokenURI: z.string().describe("A valid URL to token metadata like name, description, and image url"),
    poolSupply: z.string().describe("Amount of token to add to pool in human readable format"),
    ownerSupply: z.string().describe("Amount of token to transfer to owner in human readable format"),
    swapFee: z.number().describe("Swap fee for the pool in basis points (e.g. 100 for 1%)"),
    owner: addressSchema.describe("Address receiving owner supply and pool liquidity"),
    value: z.string().describe("Native token value in human readable Ether format representing liquidity funded")
  }),
  execute: async (client, args) => {
    // @TODO: Helper tools to create for generating token URI
    const { chainId, name, symbol, tokenURI, poolSupply, ownerSupply, swapFee, owner, value } = args;

    const ops: Op[] = [];
    const poolSupplyFormatted = parseEther(poolSupply);
    const ownerSupplyFormatted = parseEther(ownerSupply);
    const swapFeeFormatted = BigInt(swapFee);

    const data = encodeFunctionData({
      abi: CoinchanAbi,
      functionName: "make",
      args: [
        name,
        symbol,
        tokenURI,
        poolSupplyFormatted,
        ownerSupplyFormatted,
        swapFeeFormatted,
        owner
      ]
    })

    ops.push({ target: CoinchanAddress as Address, value: parseEther(value).toString(), data: data as Hex });

    const intentDescription = `Create coin ${symbol} and add liquidity`;
    const walletClient = client.getWalletClient(chainId);
    if (!walletClient) {
      return { intent: intentDescription, ops, chain: chainId };
    }

    const hash = await client.executeOps(ops, chainId);
    return { intent: intentDescription, ops, chain: chainId, hash };
  }
});

export const intentCoinchanMakeLocked = createTool({
  name: "intentCoinchanMakeLocked",
  description: "Create a new Coinchan token with locked liquidity and optional vesting schedule.",
  supportedChains,
  parameters: z.object({
    chainId: z.number().describe("Chain ID for execution (e.g. 8453 for Base)"),
    name: z.string().describe("Name of the token"),
    symbol: z.string().describe("Symbol of the token"),
    tokenURI: z.string().describe("A valid URL to token metadata like name, description, and image url"),
    poolSupply: z.string().describe("Amount of token to add to pool in human readable format (e.g. '1000')"),
    creatorSupply: z.string().describe("Amount of token to transfer to creator in human readable format (e.g. '100')"),
    swapFee: z.number().describe("Swap fee for the pool in basis points (e.g. 100 for 1%)"),
    creator: addressSchema.describe("Ethereum address of the creator"),
    unlockPeriod: z.number().describe("Number of days until liquidity unlock (e.g. 180)"),
    vesting: z.boolean().describe("Whether to enable linear vesting of locked liquidity over the unlock period"),
    value: z.string().describe("Native token value in human readable Ether format representing liquidity funded"),
  }),
  execute: async (client, args) => {
    const { chainId, name, symbol, tokenURI, poolSupply, creatorSupply, swapFee, creator, unlockPeriod, vesting, value } = args;
    const ops: Op[] = [];
    const unlockTime = BigInt(unlockPeriod * 24 * 60 * 60); // Convert days to seconds until unlock

    const data = encodeFunctionData({
    abi: CoinchanAbi,
    functionName: "makeLocked",
    args: [
      name,
      symbol,
      tokenURI,
      parseEther(poolSupply),
      parseEther(creatorSupply),
      BigInt(swapFee),
      creator,
      unlockTime,
      vesting
    ]});
    ops.push({ target: CoinchanAddress as Address, value: parseEther(value).toString(), data: data as Hex });

    const intentDescription = `Make coin ${symbol} with locked liquidity`;
    const walletClient = client.getWalletClient(chainId);
    if (!walletClient) {
      return { intent: intentDescription, ops, chain: chainId };
    }
    const hash = await client.executeOps(ops, chainId);
    return { intent: intentDescription, ops, chain: chainId, hash };
  }
});

export const intentCoinchanClaimVested = createTool({
  name: "intentCoinchanClaimVested",
  description: "Claim vested liquidity for a locked Coinchan token. Only works if vesting was enabled at creation.",
  supportedChains,
  parameters: z.object({
    chainId: z.number().describe("Chain ID for execution (e.g. 8453 for Base)"),
    coinId: z.string().describe("The Coinchan token ID as a decimal string"),
  }),
  execute: async (client, args) => {
    const { chainId, coinId } = args;
    const ops: Op[] = [];
    const data = encodeFunctionData({ abi: CoinchanAbi, functionName: "claimVested", args: [BigInt(coinId)]});
    ops.push({ target: CoinchanAddress as Address, value: "0", data: data as Hex });

    const intentDescription = `Claim vested liquidity for coin ${coinId}`;
    const walletClient = client.getWalletClient(chainId);
    if (!walletClient) {
      return { intent: intentDescription, ops, chain: chainId };
    }
    const hash = await client.executeOps(ops, chainId);
    return { intent: intentDescription, ops, chain: chainId, hash };
  }
});

export const intentCoinchanMakeHold = createTool({
  name: "intentCoinchanMakeHold",
  description: "Create a new Coinchan token and hold liquidity for the creator instead of locking it.",
  supportedChains,
  parameters: z.object({
    chainId: z.number().describe("Chain ID for execution (e.g. 8453 for Base)"),
    name: z.string().describe("Name of the token"),
    symbol: z.string().describe("Symbol of the token"),
    tokenURI: z.string().describe("A valid URL to token metadata like name, description, and image url"),
    poolSupply: z.string().describe("Amount of token to add to pool in wei as a decimal string"),
    creatorSupply: z.string().describe("Amount of token to transfer to creator in wei as a decimal string"),
    swapFee: z.number().describe("Swap fee for the pool in basis points (e.g. 100 for 1%)"),
    creator: addressSchema.describe("Ethereum address of the creator"),
    value: z.string().describe("Native token value in human readable Ether format representing liquidity funded"),
  }),
  execute: async (client, args) => {
    const { chainId, name, symbol, tokenURI, poolSupply, creatorSupply, swapFee, creator, value } = args;
    const ops: Op[] = [];
    const data = encodeFunctionData({
      abi: CoinchanAbi,
      functionName: "makeHold",
      args: [
        name,
        symbol,
        tokenURI,
        BigInt(poolSupply),
        BigInt(creatorSupply),
        BigInt(swapFee),
        creator
      ]
    });
    ops.push({ target: CoinchanAddress as Address, value: parseEther(value).toString(), data: data as Hex });

    const intentDescription = `Create coin ${symbol} and hold liquidity`;
    const walletClient = client.getWalletClient(chainId);
    if (!walletClient) {
      return { intent: intentDescription, ops, chain: chainId };
    }
    const hash = await client.executeOps(ops, chainId);
    return { intent: intentDescription, ops, chain: chainId, hash };
  }
});

export const intentCoinchanAirdrop = createTool({
  name: "intentCoinchanAirdrop",
  description: "Airdrop a Coinchan token to multiple addresses in a single transaction.",
  supportedChains,
  parameters: z.object({
    chainId: z.number().describe("Chain ID for execution (e.g. 8453 for Base)"),
    coinId: z.string().describe("The Coinchan token ID as a decimal string"),
    recipients: z.array(addressSchema).describe("Array of recipient Ethereum addresses"),
    amounts: z.array(z.string()).describe("Array of token amounts in wei as decimal strings, one per recipient"),
    totalSum: z.string().describe("Total sum of all amounts in wei as a decimal string"),
  }),
  execute: async (client, args) => {
    const { chainId, coinId, recipients, amounts, totalSum } = args;
    const ops: Op[] = [];
    const data = encodeFunctionData({
      abi: CoinchanAbi,
      functionName: "airdrop",
      args: [BigInt(coinId), recipients, amounts.map(a => BigInt(a)), BigInt(totalSum)]
    });
    ops.push({ target: CoinchanAddress as Address, value: "0", data: data as Hex });

    const intentDescription = `Coinchan.airdrop: distribute token ${coinId} to multiple recipients`;
    const walletClient = client.getWalletClient(chainId);
    if (!walletClient) {
      return { intent: intentDescription, ops, chain: chainId };
    }
    const hash = await client.executeOps(ops, chainId);
    return { intent: intentDescription, ops, chain: chainId, hash };
  }
});
