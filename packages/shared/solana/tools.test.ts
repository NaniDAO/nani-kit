/**
 * These tests hit the real Solana JSON-RPC - no mocking, in line with the rest
 * of the suite. Set SOLANA_RPC_URL to avoid the public endpoint's rate limits.
 */
import { describe, it, expect } from "vitest";
import { http } from "viem";
import { mainnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createAgentekClient,
  type AgentekClient,
  type SolanaConfig,
} from "../client.js";
import { solanaTools } from "./index.js";
import { SOLANA_TOKENS } from "./constants.js";
import {
  getSolBalanceTool,
  getSolanaAccountInfoTool,
  getSolanaNetworkStatusTool,
  getSolanaPriorityFeesTool,
  getSolanaTokenBalanceTool,
  getSolanaTokenBalancesTool,
  getSolanaTokenSupplyTool,
  getSolanaTransactionHistoryTool,
} from "./tools.js";
import {
  intentTransferSolTool,
  intentTransferSplTokenTool,
} from "./intents.js";
import { encodeBase58 } from "./base58.js";
import { withRetry } from "../test-helpers.js";

// Binance's hot wallet - permanently funded and heavily used, so reads against
// it stay meaningful over time.
const FUNDED_ADDRESS = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const RECIPIENT = "So11111111111111111111111111111111111111112";

/**
 * A fresh 32-byte key nobody has ever funded. Reserved-looking addresses like
 * the system program turn out to hold real balances, so generate instead.
 */
const unusedAddress = () =>
  encodeBase58(crypto.getRandomValues(new Uint8Array(32)));

const createSolanaTestClient = (solana: SolanaConfig = {}) =>
  createAgentekClient({
    transports: [http()],
    chains: [mainnet],
    accountOrAddress: privateKeyToAccount(generatePrivateKey()),
    tools: solanaTools(),
    solana: { rpcUrl: process.env.SOLANA_RPC_URL, ...solana },
  });

const client = createSolanaTestClient();

describe("Solana read tools", () => {
  it("getSolanaNetworkStatus reports a live slot and epoch", async () => {
    const status = await withRetry(() =>
      getSolanaNetworkStatusTool.execute(client, {}),
    );

    expect(status.slot).toBeGreaterThan(0);
    expect(status.epoch).toBeGreaterThan(0);
    expect(status.slotsInEpoch).toBeGreaterThan(0);
    expect(typeof status.solanaCore).toBe("string");
  });

  it("getSolBalance returns lamports and the SOL equivalent", async () => {
    const balance = await withRetry(() =>
      getSolBalanceTool.execute(client, { address: FUNDED_ADDRESS }),
    );

    expect(balance.address).toBe(FUNDED_ADDRESS);
    expect(BigInt(balance.lamports)).toBeGreaterThan(0n);
    expect(Number(balance.sol)).toBeCloseTo(Number(balance.lamports) / 1e9, 6);
  });

  it("getSolBalance rejects a non-Solana address", async () => {
    await expect(
      client.execute("getSolBalance", {
        address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      }),
    ).rejects.toThrow();
  });

  it("getSolanaAccountInfo describes the owning program", async () => {
    const info = await withRetry(() =>
      getSolanaAccountInfoTool.execute(client, { address: FUNDED_ADDRESS }),
    );

    // A plain wallet is owned by the system program.
    expect(info.owner).toBe("11111111111111111111111111111111");
    expect(BigInt(info.lamports)).toBeGreaterThan(0n);
    expect(info.executable).toBe(false);
  });

  it("getSolanaAccountInfo throws for an account that was never created", async () => {
    await expect(
      getSolanaAccountInfoTool.execute(client, { address: unusedAddress() }),
    ).rejects.toThrow(/does not exist/);
  });

  it("getSolanaTokenSupply reads USDC's supply and decimals", async () => {
    const supply = await withRetry(() =>
      getSolanaTokenSupplyTool.execute(client, { token: "USDC" }),
    );

    expect(supply.mint).toBe(SOLANA_TOKENS.USDC);
    expect(supply.symbol).toBe("USDC");
    expect(supply.decimals).toBe(6);
    expect(BigInt(supply.amount)).toBeGreaterThan(0n);
  });

  it("getSolanaTokenBalances lists non-zero SPL holdings", async () => {
    const result = await withRetry(() =>
      getSolanaTokenBalancesTool.execute(client, { owner: FUNDED_ADDRESS }),
    );

    expect(result.count).toBe(result.balances.length);
    for (const balance of result.balances) {
      expect(balance.amount).not.toBe("0");
      expect(typeof balance.mint).toBe("string");
      expect(["token", "token-2022"]).toContain(balance.program);
    }
  });

  it("getSolanaTokenBalance returns a zero balance rather than throwing", async () => {
    const balance = await withRetry(() =>
      getSolanaTokenBalanceTool.execute(client, {
        owner: unusedAddress(),
        token: "BONK",
      }),
    );

    expect(balance.mint).toBe(SOLANA_TOKENS.BONK);
    expect(balance.amount).toBe("0");
    expect(balance.tokenAccounts).toEqual([]);
  });

  it("getSolanaTransactionHistory paginates newest first", async () => {
    const history = await withRetry(() =>
      getSolanaTransactionHistoryTool.execute(client, {
        address: FUNDED_ADDRESS,
        limit: 5,
      }),
    );

    expect(history.transactions.length).toBeGreaterThan(0);
    expect(history.transactions.length).toBeLessThanOrEqual(5);

    const slots = history.transactions.map((tx: any) => tx.slot);
    expect([...slots].sort((a, b) => b - a)).toEqual(slots);
  });

  it("getSolanaPriorityFees summarises fees as percentiles", async () => {
    const fees = await withRetry(() =>
      getSolanaPriorityFeesTool.execute(client, {}),
    );

    expect(fees.sampleSlots).toBeGreaterThan(0);
    expect(fees.min).toBeLessThanOrEqual(fees.median);
    expect(fees.median).toBeLessThanOrEqual(fees.p95);
    expect(fees.p95).toBeLessThanOrEqual(fees.max);
    expect(fees.recommended).toBe(fees.p75);
  });
});

describe("Solana intents", () => {
  it("rejects an RPC-selected program outside Token and Token-2022", async () => {
    const { PublicKey } = await import("@solana/web3.js");
    const unsupportedProgram = new PublicKey(unusedAddress());
    const fakeClient = {
      getSolanaAddress: async () => FUNDED_ADDRESS,
      getSolanaRpcUrl: () => "https://rpc.example",
      awaitSolanaPreSubmission: async <T>(promise: Promise<T>) => promise,
      getSolanaConnection: async () => ({
        getAccountInfo: async () => ({ owner: unsupportedProgram }),
      }),
    } as unknown as AgentekClient;

    await expect(
      intentTransferSplTokenTool.execute(fakeClient, {
        token: "USDC",
        to: RECIPIENT,
        amount: "1",
      }),
    ).rejects.toThrow(/only the canonical Token and Token-2022 programs/);
  });

  it("returns an unsigned transaction when no key is configured", async () => {
    const watchOnly = createSolanaTestClient({ address: FUNDED_ADDRESS });

    const intent = await withRetry(() =>
      intentTransferSolTool.execute(watchOnly, {
        to: RECIPIENT,
        amount: "0.001",
      }),
    );

    expect(intent.chain).toBe("solana");
    expect(intent.intent).toBe(`send 0.001 SOL to ${RECIPIENT}`);
    expect(intent.signature).toBeUndefined();

    // The transaction must deserialise and name the payer, but carry no signature.
    const { VersionedTransaction } = await import("@solana/web3.js");
    const transaction = VersionedTransaction.deserialize(
      Buffer.from(intent.transaction, "base64"),
    );
    expect(
      transaction.message.staticAccountKeys[0].toBase58(),
    ).toBe(FUNDED_ADDRESS);
    expect(transaction.signatures.every((sig) => sig.every((b) => b === 0))).toBe(true);
  });

  it("refuses to spend more than the account holds", async () => {
    const watchOnly = createSolanaTestClient({ address: RECIPIENT });

    await expect(
      intentTransferSolTool.execute(watchOnly, {
        to: FUNDED_ADDRESS,
        amount: "1000000000",
      }),
    ).rejects.toThrow(/less than the 1000000000 SOL requested/);
  });

  it("builds an SPL transfer that creates the recipient's token account", async () => {
    const watchOnly = createSolanaTestClient({ address: FUNDED_ADDRESS });

    const intent = await withRetry(() =>
      intentTransferSplTokenTool.execute(watchOnly, {
        token: "USDC",
        to: RECIPIENT,
        amount: "1",
      }),
    );

    expect(intent.intent).toBe(`send 1 USDC to ${RECIPIENT}`);
    expect(intent.signature).toBeUndefined();

    const { VersionedTransaction } = await import("@solana/web3.js");
    const transaction = VersionedTransaction.deserialize(
      Buffer.from(intent.transaction, "base64"),
    );
    const programIds = transaction.message.compiledInstructions.map((ix) =>
      transaction.message.staticAccountKeys[ix.programIdIndex].toBase58(),
    );

    // Idempotent ATA creation, then the checked transfer.
    expect(programIds).toContain("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    expect(programIds).toContain(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    );
  }, 60_000);

  it("refuses an SPL transfer from a wallet holding none of the token", async () => {
    const watchOnly = createSolanaTestClient({ address: unusedAddress() });

    await expect(
      intentTransferSplTokenTool.execute(watchOnly, {
        token: "BONK",
        to: RECIPIENT,
        amount: "1",
      }),
    ).rejects.toThrow(/has no token account/);
  }, 60_000);

  it("refuses an SPL transfer to a token account rather than a wallet", async () => {
    const watchOnly = createSolanaTestClient({ address: FUNDED_ADDRESS });
    const { PublicKey } = await import("@solana/web3.js");
    const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = await import(
      "@solana/spl-token"
    );

    // What a block explorer shows for a token holding, and a routine thing to
    // paste in place of the wallet that owns it. It is a PDA, so it is a valid
    // 32-byte key that passes address validation but can never sign.
    const tokenAccount = getAssociatedTokenAddressSync(
      new PublicKey(SOLANA_TOKENS.USDC),
      new PublicKey(FUNDED_ADDRESS),
      false,
      TOKEN_PROGRAM_ID,
    ).toBase58();

    expect(PublicKey.isOnCurve(new PublicKey(tokenAccount).toBytes())).toBe(
      false,
    );

    await expect(
      intentTransferSplTokenTool.execute(watchOnly, {
        token: "USDC",
        to: tokenAccount,
        amount: "1",
      }),
    ).rejects.toThrow(/is a token account, not its owner's wallet address/);
  }, 60_000);

  it("allows a program-controlled PDA treasury as the recipient owner", async () => {
    const watchOnly = createSolanaTestClient({ address: FUNDED_ADDRESS });
    const { PublicKey } = await import("@solana/web3.js");
    const [treasury] = PublicKey.findProgramAddressSync(
      [Buffer.from("agentek-recipient-test")],
      new PublicKey("11111111111111111111111111111111"),
    );

    const intent = await withRetry(() =>
      intentTransferSplTokenTool.execute(watchOnly, {
        token: "USDC",
        to: treasury.toBase58(),
        amount: "1",
      }),
    );

    expect(intent.intent).toBe(`send 1 USDC to ${treasury.toBase58()}`);
    expect(intent.signature).toBeUndefined();
  }, 60_000);

  it("explains itself when no Solana account is configured at all", async () => {
    await expect(
      intentTransferSolTool.execute(client, { to: RECIPIENT, amount: "0.001" }),
    ).rejects.toThrow(/No Solana account configured/);
  });
});

describe("solanaTools collection", () => {
  it("registers every tool with a unique name and a description", () => {
    const tools = solanaTools();
    const names = tools.map((tool) => tool.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("getSolBalance");
    expect(names).toContain("intentTransferSplToken");
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(typeof tool.execute).toBe("function");
    }
  });
});

describe("solanaTools options", () => {
  it("drops every fund-moving tool when intents are excluded", () => {
    const names = solanaTools({ includeIntents: false }).map((tool) => tool.name);

    expect(names).not.toContain("intentTransferSol");
    expect(names).not.toContain("intentTransferSplToken");
    expect(names).not.toContain("intentSwapSolana");
    // Reads and market data survive.
    expect(names).toContain("getSolBalance");
    expect(names).toContain("searchSolanaTokens");
  });

  it("keeps the intents by default", () => {
    const names = solanaTools().map((tool) => tool.name);

    expect(names).toContain("intentTransferSol");
    expect(names).toContain("intentTransferSplToken");
    expect(names).toContain("intentSwapSolana");
  });
});

describe("cluster parameter", () => {
  it("refuses an arbitrary endpoint, so a tool call cannot choose its own host", () => {
    const schema = getSolBalanceTool.parameters;

    for (const cluster of [
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:8899",
      "https://evil.example/rpc",
      "file:///etc/passwd",
    ]) {
      expect(
        schema.safeParse({ address: FUNDED_ADDRESS, cluster }).success,
      ).toBe(false);
    }
  });

  it("rejects the removed rpcUrl parameter instead of silently changing clusters", () => {
    expect(
      getSolBalanceTool.parameters.safeParse({
        address: FUNDED_ADDRESS,
        rpcUrl: "https://api.devnet.solana.com",
      }).success,
    ).toBe(false);
  });

  it("accepts the known clusters and defaults to the configured endpoint", () => {
    const schema = getSolBalanceTool.parameters;

    for (const cluster of ["mainnet-beta", "devnet", "testnet"]) {
      expect(
        schema.safeParse({ address: FUNDED_ADDRESS, cluster }).success,
      ).toBe(true);
    }
    expect(schema.safeParse({ address: FUNDED_ADDRESS }).success).toBe(true);
  });
});
