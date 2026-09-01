/**
 * Verifies the Solana signing path without needing a funded account: the
 * public faucets are unreliable, but an unfunded transfer still proves the
 * signature is well-formed and that the RPC accepts it before failing on
 * balance.
 */
import { describe, it, expect, vi } from "vitest";
import { createPublicKey, verify } from "node:crypto";
import { http } from "viem";
import { mainnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createAgentekClient, type SolanaConfig } from "../client.js";
import { solanaTools } from "./index.js";
import { intentTransferSolTool } from "./intents.js";
import { decodeBase58, encodeBase58 } from "./base58.js";

const RPC = process.env.SOLANA_DEVNET_RPC_URL || "https://api.devnet.solana.com";

// node:crypto wants ed25519 keys in SPKI, not as raw 32 bytes.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const toKeyObject = (raw: Uint8Array) =>
  createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(raw)]),
    format: "der",
    type: "spki",
  });

const sender = Keypair.generate();
const recipient = Keypair.generate();

const createClient = (solana: SolanaConfig) =>
  createAgentekClient({
    transports: [http()],
    chains: [mainnet],
    accountOrAddress: privateKeyToAccount(generatePrivateKey()),
    tools: solanaTools(),
    solana: { rpcUrl: RPC, ...solana },
  });

describe("Solana signing", () => {
  it("accepts a secret key as base58, a JSON array, or raw bytes", async () => {
    const expected = sender.publicKey.toBase58();

    for (const privateKey of [
      encodeBase58(sender.secretKey),
      JSON.stringify([...sender.secretKey]),
      sender.secretKey,
    ]) {
      expect(await createClient({ privateKey }).getSolanaAddress()).toBe(expected);
    }
  });

  it("prefers the signer's address over a configured watch address", async () => {
    const client = createClient({
      privateKey: encodeBase58(sender.secretKey),
      address: recipient.publicKey.toBase58(),
    });

    expect(await client.getSolanaAddress()).toBe(sender.publicKey.toBase58());
  });

  it("signs the compiled message with a signature the sender's key verifies", async () => {
    const client = createClient({ privateKey: encodeBase58(sender.secretKey) });

    const { transaction, blockhash, lastValidBlockHeight } =
      await client.buildSolanaTransaction([
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 1000n,
        }),
      ]);

    // The account is unfunded, so preflight definitively rejects it. A known
    // SendTransactionError remains an error rather than ambiguous submission.
    const error = await client
      .executeSolanaTransaction(transaction, blockhash, lastValidBlockHeight)
      .then(() => null, (reason: Error) => reason);
    expect(error).toBeInstanceOf(SendTransactionError);

    const signed = VersionedTransaction.deserialize(transaction.serialize());
    expect(
      verify(
        null,
        Buffer.from(signed.message.serialize()),
        toKeyObject(decodeBase58(sender.publicKey.toBase58())),
        Buffer.from(signed.signatures[0]),
      ),
    ).toBe(true);
  }, 60_000);

  it("retains the signature when confirmation fails after submission", async () => {
    const client = createClient({ privateKey: encodeBase58(sender.secretKey) });
    const blockhash = PublicKey.default.toBase58();
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: sender.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: sender.publicKey,
            toPubkey: recipient.publicKey,
            lamports: 1n,
          }),
        ],
      }).compileToV0Message(),
    );

    const connection = {
      sendRawTransaction: vi.fn(async (raw: Uint8Array) => {
        const submitted = VersionedTransaction.deserialize(raw);
        return encodeBase58(submitted.signatures[0]);
      }),
      confirmTransaction: vi.fn(async () => {
        throw new Error("confirmation transport failed");
      }),
    };
    (client as any).solanaConnection = connection;

    const result = await client.executeSolanaTransaction(
      transaction,
      blockhash,
      123,
    );

    expect(result).toEqual({
      signature: encodeBase58(transaction.signatures[0]),
      confirmationStatus: "submitted",
    });
    expect(connection.sendRawTransaction).toHaveBeenCalledOnce();
    expect(connection.confirmTransaction).toHaveBeenCalledOnce();
  });

  it("returns an unknown outcome with the local signature when submission throws", async () => {
    const client = createClient({ privateKey: encodeBase58(sender.secretKey) });
    const blockhash = PublicKey.default.toBase58();
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: sender.publicKey,
        recentBlockhash: blockhash,
        instructions: [],
      }).compileToV0Message(),
    );

    const connection = {
      sendRawTransaction: vi.fn(async () => {
        throw new Error("connection reset after request write");
      }),
      confirmTransaction: vi.fn(),
    };
    (client as any).solanaConnection = connection;

    const result = await client.executeSolanaTransaction(
      transaction,
      blockhash,
      123,
    );

    expect(result).toEqual({
      signature: encodeBase58(transaction.signatures[0]),
      confirmationStatus: "unknown",
    });
    expect(connection.confirmTransaction).not.toHaveBeenCalled();
  });

  it("rethrows a definitive preflight rejection", async () => {
    const client = createClient({ privateKey: encodeBase58(sender.secretKey) });
    const blockhash = PublicKey.default.toBase58();
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: sender.publicKey,
        recentBlockhash: blockhash,
        instructions: [],
      }).compileToV0Message(),
    );
    const rejection = new SendTransactionError({
      action: "simulate",
      signature: "",
      transactionMessage: "insufficient funds",
    });
    const connection = {
      sendRawTransaction: vi.fn(async () => {
        throw rejection;
      }),
      confirmTransaction: vi.fn(),
    };
    (client as any).solanaConnection = connection;

    await expect(
      client.executeSolanaTransaction(transaction, blockhash, 123),
    ).rejects.toBe(rejection);
    expect(connection.confirmTransaction).not.toHaveBeenCalled();
  });

  it("bounds a stalled confirmation and returns a reconcilable status", async () => {
    vi.useFakeTimers();
    try {
      const client = createClient({ privateKey: encodeBase58(sender.secretKey) });
      (client as any).solanaKeypair = sender;
      const blockhash = PublicKey.default.toBase58();
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: sender.publicKey,
          recentBlockhash: blockhash,
          instructions: [],
        }).compileToV0Message(),
      );
      const connection = {
        sendRawTransaction: vi.fn(async (raw: Uint8Array) =>
          encodeBase58(
            VersionedTransaction.deserialize(raw).signatures[0],
          ),
        ),
        confirmTransaction: vi.fn(
          () => new Promise<never>(() => undefined),
        ),
      };
      (client as any).solanaConnection = connection;

      const execution = client.executeSolanaTransaction(
        transaction,
        blockhash,
        123,
      );
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(120_000);

      await expect(execution).resolves.toEqual({
        signature: encodeBase58(transaction.signatures[0]),
        confirmationStatus: "submitted",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks the balance before building a transfer it cannot fund", async () => {
    const client = createClient({ privateKey: encodeBase58(sender.secretKey) });

    await expect(
      intentTransferSolTool.execute(client, {
        to: recipient.publicKey.toBase58(),
        amount: "0.25",
      }),
    ).rejects.toThrow(/holds 0 SOL, less than the 0.25 SOL requested/);
  }, 60_000);

  it("applies a priority fee as a compute budget instruction", async () => {
    const client = createClient({ address: sender.publicKey.toBase58() });

    const intent = await intentTransferSolTool.execute(client, {
      to: recipient.publicKey.toBase58(),
      amount: "0",
      priorityFeeMicroLamports: 5000,
    });

    const transaction = VersionedTransaction.deserialize(
      Buffer.from(intent.transaction, "base64"),
    );
    const programIds = transaction.message.compiledInstructions.map((ix) =>
      transaction.message.staticAccountKeys[ix.programIdIndex].toBase58(),
    );

    expect(programIds).toContain("ComputeBudget111111111111111111111111111111");
    expect(programIds).toContain(SystemProgram.programId.toBase58());
  }, 60_000);
});
