/**
 * Verifies the Solana signing path without needing a funded account: the
 * public faucets are unreliable, but an unfunded transfer still proves the
 * signature is well-formed and that the RPC accepts it before failing on
 * balance.
 */
import { describe, it, expect } from "vitest";
import { createPublicKey, verify } from "node:crypto";
import { http } from "viem";
import { mainnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  Keypair,
  PublicKey,
  SystemProgram,
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

    // The account is unfunded, so the RPC verifies the signature and then
    // rejects on balance. That rejection is the proof the signature passed.
    const error = await client
      .executeSolanaTransaction(transaction, blockhash, lastValidBlockHeight)
      .then(() => null, (e: Error) => e);

    expect(error?.message).toMatch(/no record of a prior credit/);

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
