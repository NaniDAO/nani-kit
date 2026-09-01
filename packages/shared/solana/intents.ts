import { z } from "zod";
import { parseUnits } from "viem";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { AgentekClient, createTool, SolanaIntent } from "../client.js";
import {
  SOLANA_MINT_SYMBOLS,
  SOL_DECIMALS,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants.js";
import { formatLamports, resolveSolanaMint, solanaAddressSchema } from "./utils.js";

const priorityFeeParameter = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe(
    "Priority fee in micro-lamports per compute unit. Call getSolanaPriorityFees for a value that lands under current contention.",
  );

const computeBudgetInstructions = async (
  priorityFeeMicroLamports?: number,
): Promise<TransactionInstruction[]> => {
  if (priorityFeeMicroLamports === undefined) return [];
  const { ComputeBudgetProgram } = await import("@solana/web3.js");
  return [
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: priorityFeeMicroLamports,
    }),
  ];
};

/**
 * Mirrors the EVM intent tools: sign and submit when a key is configured,
 * otherwise hand back the unsigned transaction for the caller to sign.
 */
const settle = async (
  client: AgentekClient,
  instructions: TransactionInstruction[],
  intent: string,
): Promise<SolanaIntent> => {
  const { transaction, blockhash, lastValidBlockHeight } =
    await client.buildSolanaTransaction(instructions);

  const keypair = await client.getSolanaKeypair();
  if (!keypair) {
    return {
      intent,
      chain: "solana",
      transaction: Buffer.from(transaction.serialize()).toString("base64"),
    };
  }

  const execution = await client.executeSolanaTransaction(
    transaction,
    blockhash,
    lastValidBlockHeight,
  );

  return {
    intent,
    chain: "solana",
    transaction: Buffer.from(transaction.serialize()).toString("base64"),
    signature: execution.signature,
    confirmationStatus: execution.confirmationStatus,
  };
};

const intentTransferSolParameters = z.object({
  to: solanaAddressSchema.describe("Recipient Solana address (base58)"),
  amount: z
    .string()
    .describe("Amount of SOL in human-readable units (e.g. '0.25' for a quarter SOL)"),
  priorityFeeMicroLamports: priorityFeeParameter,
});

export const intentTransferSolTool = createTool({
  name: "intentTransferSol",
  description:
    "Transfer native SOL to an address. Signs and submits when a Solana key is configured, otherwise returns an unsigned base64 transaction for you to sign.",
  parameters: intentTransferSolParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentTransferSolParameters>,
  ): Promise<SolanaIntent> => {
    const { PublicKey, SystemProgram } = await import("@solana/web3.js");

    const from = await client.getSolanaAddress();
    const lamports = parseUnits(args.amount, SOL_DECIMALS);

    const connection = await client.getSolanaConnection();
    const balance = await client.awaitSolanaPreSubmission(
      connection.getBalance(new PublicKey(from)),
      "getBalance",
    );
    if (BigInt(balance) < lamports) {
      throw new Error(
        `${from} holds ${formatLamports(balance)} SOL, less than the ${args.amount} SOL requested`,
      );
    }

    const instructions = [
      ...(await computeBudgetInstructions(args.priorityFeeMicroLamports)),
      SystemProgram.transfer({
        fromPubkey: new PublicKey(from),
        toPubkey: new PublicKey(args.to),
        lamports,
      }),
    ];

    return settle(client, instructions, `send ${args.amount} SOL to ${args.to}`);
  },
});

const intentTransferSplTokenParameters = z.object({
  token: z
    .string()
    .describe(
      "SPL token mint address (base58), or a known symbol like 'USDC', 'USDT', 'BONK', 'JUP'",
    ),
  to: solanaAddressSchema.describe(
    "Recipient wallet address (base58). Its associated token account is created if it doesn't exist yet, at your expense.",
  ),
  amount: z
    .string()
    .describe(
      "Amount in human-readable units (e.g. '25.5'). Decimals are read from the mint.",
    ),
  priorityFeeMicroLamports: priorityFeeParameter,
});

export const intentTransferSplTokenTool = createTool({
  name: "intentTransferSplToken",
  description:
    "Transfer an SPL token (including Token-2022 mints) to a wallet address, creating the recipient's associated token account if needed. Signs and submits when a Solana key is configured, otherwise returns an unsigned base64 transaction.",
  parameters: intentTransferSplTokenParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentTransferSplTokenParameters>,
  ): Promise<SolanaIntent> => {
    const { PublicKey } = await import("@solana/web3.js");
    const {
      createAssociatedTokenAccountIdempotentInstruction,
      createTransferCheckedInstruction,
      getAssociatedTokenAddressSync,
      getMint,
    } = await import("@solana/spl-token");

    const from = await client.getSolanaAddress();
    const connection = await client.getSolanaConnection();
    const mint = new PublicKey(resolveSolanaMint(args.token));

    // Token and Token-2022 mints are owned by different programs, and both the
    // ATA derivation and the transfer instruction need the right one.
    const mintAccount = await client.awaitSolanaPreSubmission(
      connection.getAccountInfo(mint),
      "getAccountInfo(mint)",
    );
    if (!mintAccount) {
      throw new Error(
        `Mint ${mint.toBase58()} does not exist on the configured Solana RPC`,
      );
    }
    const programId = mintAccount.owner;
    const programAddress = programId.toBase58();
    if (
      programAddress !== TOKEN_PROGRAM_ID &&
      programAddress !== TOKEN_2022_PROGRAM_ID
    ) {
      throw new Error(
        `Mint ${mint.toBase58()} is owned by unsupported program ${programAddress}; only the canonical Token and Token-2022 programs are allowed`,
      );
    }

    const { decimals } = await client.awaitSolanaPreSubmission(
      getMint(connection, mint, undefined, programId),
      "getMint",
    );
    const amount = parseUnits(args.amount, decimals);

    const owner = new PublicKey(from);
    const recipient = new PublicKey(args.to);
    // allowOwnerOffCurve stays on for the source: the configured account may
    // legitimately be a PDA-owned treasury, and getting it wrong only means
    // the transfer finds no balance.
    const source = getAssociatedTokenAddressSync(mint, owner, true, programId);

    // Reject the concrete pasted-token-account mistake while preserving
    // legitimate PDA-controlled treasuries and vaults as recipient owners.
    const recipientAccount = await client.awaitSolanaPreSubmission(
      connection.getAccountInfo(recipient),
      "getAccountInfo(recipient)",
    );
    const recipientOwner = recipientAccount?.owner.toBase58();
    if (
      recipientOwner === TOKEN_PROGRAM_ID ||
      recipientOwner === TOKEN_2022_PROGRAM_ID
    ) {
      throw new Error(
        `Recipient ${args.to} is a token account, not its owner's wallet address. Pass the owner wallet instead; its associated token account is derived for you.`,
      );
    }
    const destination = getAssociatedTokenAddressSync(
      mint,
      recipient,
      true,
      programId,
    );

    const sourceBalance = await client
      .awaitSolanaPreSubmission(
        connection.getTokenAccountBalance(source),
        "getTokenAccountBalance",
      )
      .catch(() => null);
    if (!sourceBalance) {
      throw new Error(
        `${from} has no token account for ${mint.toBase58()}, so it holds none of this token`,
      );
    }
    if (BigInt(sourceBalance.value.amount) < amount) {
      throw new Error(
        `${from} holds ${sourceBalance.value.uiAmountString} of ${mint.toBase58()}, less than the ${args.amount} requested`,
      );
    }

    const symbol = SOLANA_MINT_SYMBOLS[mint.toBase58()] ?? mint.toBase58();
    const instructions = [
      ...(await computeBudgetInstructions(args.priorityFeeMicroLamports)),
      // Idempotent: a no-op when the recipient already has the account.
      createAssociatedTokenAccountIdempotentInstruction(
        owner,
        destination,
        recipient,
        mint,
        programId,
      ),
      createTransferCheckedInstruction(
        source,
        mint,
        destination,
        owner,
        amount,
        decimals,
        [],
        programId,
      ),
    ];

    return settle(
      client,
      instructions,
      `send ${args.amount} ${symbol} to ${args.to}`,
    );
  },
});
