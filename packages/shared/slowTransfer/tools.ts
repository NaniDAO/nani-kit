import { z } from "zod";
import { createTool } from "../client.js";
import type { AgentekClient } from "../client.js";
import { SLOW_ADDRESS, SLOW_CHAIN_ID, slowAbi, slowTransferChains } from "./constants.js";
import { addressSchema } from "../utils.js";

/**
 * SLOW is deployed only on Base, and these tools declare only Base. They used
 * to call `client.getPublicClient()` with no argument, which returns whichever
 * chain happens to be first in the client's map — mainnet, for the CLI and the
 * MCP server. A different contract occupies the same address there, so reads
 * silently answered from the wrong chain instead of failing.
 */
const slowClient = (client: AgentekClient) => client.getPublicClient(SLOW_CHAIN_ID);

export const getSlowStatus = createTool({
  name: "getSlowStatus",
  description:
    "Get information about tokens, unlocked balances, and pending transfers in SLOW",
  supportedChains: slowTransferChains,
  parameters: z.object({
    user: addressSchema.describe("The user address to check"),
    tokenId: z
      .string()
      .optional()
      .describe("Optional specific token ID to check"),
    transferId: z
      .string()
      .optional()
      .describe("Optional specific transfer ID to check"),
  }),
  execute: async (client, args) => {
    const { user, tokenId, transferId } = args;
    const publicClient = slowClient(client);

    // `user` is the only required parameter, and it used to be read out of args
    // and never used: with neither optional id supplied the tool returned "{}".
    // The account-level view is what the default call should answer.
    const [guardian, lastGuardianChange] = await Promise.all([
      publicClient.readContract({
        address: SLOW_ADDRESS,
        abi: slowAbi,
        functionName: "guardians",
        args: [user],
      }),
      publicClient.readContract({
        address: SLOW_ADDRESS,
        abi: slowAbi,
        functionName: "lastGuardianChange",
        args: [user],
      }),
    ]);

    let result: Record<string, unknown> = {
      user,
      guardian: {
        address: guardian,
        hasGuardian:
          guardian !== "0x0000000000000000000000000000000000000000",
        lastChanged: Number(lastGuardianChange),
      },
    };

    if (tokenId) {
      const unlockedBalance = await publicClient.readContract({
        address: SLOW_ADDRESS,
        abi: slowAbi,
        functionName: "unlockedBalances",
        args: [user, BigInt(tokenId)],
      });

      const token = await publicClient.readContract({
        address: SLOW_ADDRESS,
        abi: slowAbi,
        functionName: "decodeId",
        args: [BigInt(tokenId)],
      });

      result = {
        ...result,
        tokenInfo: {
          id: tokenId,
          token: token[0],
          delay: Number(token[1]),
          unlockedBalance: unlockedBalance.toString(),
        },
      };
    }

    if (transferId) {
      const transfer = await publicClient.readContract({
        address: SLOW_ADDRESS,
        abi: slowAbi,
        functionName: "pendingTransfers",
        args: [BigInt(transferId)],
      });

      const canReverse = await publicClient.readContract({
        address: SLOW_ADDRESS,
        abi: slowAbi,
        functionName: "canReverseTransfer",
        args: [BigInt(transferId)],
      });

      result = {
        ...result,
        transfer: {
          timestamp: Number(transfer[0]),
          from: transfer[1],
          to: transfer[2],
          id: transfer[3].toString(),
          amount: transfer[4].toString(),
          canReverse: canReverse[0],
          reasonIfCannotReverse: canReverse[1],
        },
      };
    }

    // Returned as an object like every other read tool; the MCP and CLI layers
    // do their own serialisation, so stringifying here double-encoded it.
    return result;
  },
});

export const predictTransferId = createTool({
  name: "predictTransferId",
  description: "Predict a transfer ID for a potential transfer",
  supportedChains: slowTransferChains,
  parameters: z.object({
    from: addressSchema.describe("The sender address"),
    to: addressSchema.describe("The recipient address"),
    id: z.string().describe("The token ID"),
    amount: z.string().describe("The transfer amount"),
  }),
  execute: async (client, args) => {
    const { from, to, id, amount } = args;
    const publicClient = slowClient(client);

    const transferId = await publicClient.readContract({
      address: SLOW_ADDRESS,
      abi: slowAbi,
      functionName: "predictTransferId",
      args: [from, to, BigInt(id), BigInt(amount)],
    });

    return `Predicted Transfer ID: ${transferId.toString()}`;
  },
});

export const canUnlockSlow = createTool({
  name: "canUnlockSlow",
  description: "Check if a transfer can be unlocked and get info about it",
  supportedChains: slowTransferChains,
  parameters: z.object({
    transferId: z.string().describe("The transfer ID to check"),
  }),
  execute: async (client, args) => {
    const { transferId } = args;
    const publicClient = slowClient(client);

    const transfer = await publicClient.readContract({
      address: SLOW_ADDRESS,
      abi: slowAbi,
      functionName: "pendingTransfers",
      args: [BigInt(transferId)],
    });

    if (Number(transfer[0]) === 0) {
      return `Transfer with ID ${transferId} does not exist.`;
    }

    const tokenId = transfer[3];
    const decodedId = await publicClient.readContract({
      address: SLOW_ADDRESS,
      abi: slowAbi,
      functionName: "decodeId",
      args: [tokenId],
    });

    const timestamp = Number(transfer[0]);
    const delay = Number(decodedId[1]);
    const unlockTime = timestamp + delay;
    const currentTime = Math.floor(Date.now() / 1000);

    let canUnlock = currentTime > unlockTime;

    return {
      transferId,
      from: transfer[1],
      to: transfer[2],
      tokenId: tokenId.toString(),
      amount: transfer[4].toString(),
      timestamp,
      delay,
      unlockTime,
      timeRemaining: canUnlock ? 0 : unlockTime - currentTime,
      canUnlock,
    };
  },
});

export const reverseSlowTransfer = createTool({
  name: "getCanReverseSlowTransfer",
  description: "Check if a transfer can be reversed",
  supportedChains: slowTransferChains,
  parameters: z.object({
    transferId: z.string().describe("The transfer ID to check"),
  }),
  execute: async (client, args) => {
    const { transferId } = args;
    const publicClient = slowClient(client);

    const canReverse = await publicClient.readContract({
      address: SLOW_ADDRESS,
      abi: slowAbi,
      functionName: "canReverseTransfer",
      args: [BigInt(transferId)],
    });

    if (!canReverse[0]) {
      return `Transfer with ID ${transferId} cannot be reversed. Reason: ${canReverse[1]}`;
    }

    const transfer = await publicClient.readContract({
      address: SLOW_ADDRESS,
      abi: slowAbi,
      functionName: "pendingTransfers",
      args: [BigInt(transferId)],
    });

    return {
      transferId,
      canReverse: canReverse[0],
      from: transfer[1],
      to: transfer[2],
      tokenId: transfer[3].toString(),
      amount: transfer[4].toString(),
    };
  },
});

export const getSlowGuardianInfo = createTool({
  name: "getSlowGuardianInfo",
  description: "Get guardian information for a user",
  supportedChains: slowTransferChains,
  parameters: z.object({
    user: addressSchema.describe("The user address to check"),
  }),
  execute: async (client, args) => {
    const { user } = args;
    const publicClient = slowClient(client);

    const guardian = await publicClient.readContract({
      address: SLOW_ADDRESS,
      abi: slowAbi,
      functionName: "guardians",
      args: [user],
    });

    const [canChange, cooldownEndsAt] = await publicClient.readContract({
      address: SLOW_ADDRESS,
      abi: slowAbi,
      functionName: "canChangeGuardian",
      args: [user],
    });

    const lastGuardianChange = await publicClient.readContract({
      address: SLOW_ADDRESS,
      abi: slowAbi,
      functionName: "lastGuardianChange",
      args: [user],
    });

    return {
      user,
      currentGuardian: guardian,
      hasGuardian: guardian !== "0x0000000000000000000000000000000000000000",
      canChangeGuardian: canChange,
      cooldownEndsAt: Number(cooldownEndsAt),
      lastChanged: Number(lastGuardianChange),
    };
  },
});

export const approveSlowTransfer = createTool({
  name: "getSlowTransferApprovalRequired",
  description: "Check if a transfer needs guardian approval",
  supportedChains: slowTransferChains,
  parameters: z.object({
    user: addressSchema.describe("The user address"),
    to: addressSchema.describe("The recipient address"),
    id: z.string().describe("The token ID"),
    amount: z.string().describe("The amount to transfer"),
  }),
  execute: async (client, args) => {
    const { user, to, id, amount } = args;
    const publicClient = slowClient(client);

    const needsApproval = await publicClient.readContract({
      address: SLOW_ADDRESS,
      abi: slowAbi,
      functionName: "isGuardianApprovalNeeded",
      args: [user, to, BigInt(id), BigInt(amount)],
    });

    const guardian = await publicClient.readContract({
      address: SLOW_ADDRESS,
      abi: slowAbi,
      functionName: "guardians",
      args: [user],
    });

    const transferId = await publicClient.readContract({
      address: SLOW_ADDRESS,
      abi: slowAbi,
      functionName: "predictTransferId",
      args: [user, to, BigInt(id), BigInt(amount)],
    });

    return {
      user,
      guardian,
      needsApproval,
      transferId: transferId.toString(),
    };
  },
});
