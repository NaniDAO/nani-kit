import {
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
  type Account,
  createPublicClient,
  createWalletClient,
  Address,
  Hex,
  SignableMessage,
  TypedDataParameter,
  TypedDataDomain
} from "viem";
import { z } from "zod";
import type {
  Connection,
  Keypair,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { DEFAULT_SOLANA_RPC_URL } from "./solana/constants.js";
import { decodeBase58, encodeBase58 } from "./solana/base58.js";

const SOLANA_RPC_OUTCOME_TIMEOUT_MS = 120_000;

type RpcStageResult<T> =
  | { kind: "value"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "timeout" };

/**
 * Bound an RPC stage without pretending cancellation occurred. The underlying
 * request may still finish, so callers receive the locally-derived signature
 * and an explicit ambiguous status rather than a retryable timeout error.
 */
async function awaitSolanaRpcStage<T>(
  promise: Promise<T>,
  timeoutMs = SOLANA_RPC_OUTCOME_TIMEOUT_MS,
): Promise<RpcStageResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RpcStageResult<T>>((resolve) => {
    timer = setTimeout(
      () => resolve({ kind: "timeout" }),
      timeoutMs,
    );
  });
  const outcome: Promise<RpcStageResult<T>> = promise.then(
    (value): RpcStageResult<T> => ({ kind: "value", value }),
    (error): RpcStageResult<T> => ({ kind: "error", error }),
  );
  try {
    return await Promise.race([outcome, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Base interface for all tools
export interface BaseTool {
  name: string;
  description: string;
  parameters: z.ZodObject<any, any, any, any>;
  execute: (client: AgentekClient, args: any) => Promise<any>;
  supportedChains?: Chain[];
}

export interface Op {
  target: Address;
  value: string; // wei encoded
  data: Hex;
}

// EIP-191 Personal Sign operation
export interface PersonalSign {
  type: 'personal_sign';
  message: SignableMessage;
}

// EIP-712 Typed Data Sign operation
export interface TypedDataSign {
  type: "typed_data_sign";
  domain: TypedDataDomain;
  types: Record<string, readonly TypedDataParameter[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

// Union type for all signing operations
export type Sign = PersonalSign | TypedDataSign;

// Extended operation that can be either a transaction or a signature
export type Operation = Op | Sign;

// RequestIntent - this structure matches what we consume on nani.ooo
// You can extend it to include hash when saving if approved by user
interface RequestIntent {
  intent: string;
  ops: Operation[];
  chain: number;
}

interface CompletedIntent {
  intent: string;
  ops: Operation[];
  chain: number;
  hash?: string;
  signatures?: string[];
}

export type Intent = RequestIntent | CompletedIntent;

/**
 * Solana settings. Read tools work without any of this; writes need
 * `privateKey`, and `address` alone gives a watch-only account.
 */
export interface SolanaConfig {
  /** JSON-RPC endpoint. Falls back to SOLANA_RPC_URL, then the public mainnet-beta endpoint. */
  rpcUrl?: string;
  /**
   * Signer secret key in any of the shapes wallets export it: a base58 string
   * (Phantom), a JSON byte array (solana-keygen), or the raw 64 bytes.
   */
  privateKey?: string | number[] | Uint8Array;
  /** Base58 public key to act as, when no privateKey is configured. */
  address?: string;
  /** Jupiter API key for Tokens V2 and Swap V2. Never expose it as a tool argument. */
  jupiterApiKey?: string;
}

/**
 * Solana counterpart to Intent. Solana has no numeric chain id and no
 * target/value/calldata model, so intents carry the compiled transaction.
 */
export interface SolanaIntent {
  intent: string;
  chain: "solana";
  /** Base64 v0 transaction — unsigned when agentek holds no key, so you can sign it yourself. */
  transaction: string;
  /** Present once agentek signed and submitted the transaction. */
  signature?: string;
  /**
   * `confirmed` is final for the requested commitment. `submitted` means the
   * RPC accepted the transaction but confirmation could not be observed.
   * `unknown` means submission itself returned ambiguously. Never rebuild and
   * retry the latter two statuses before reconciling `signature` on-chain.
   */
  confirmationStatus?: SolanaConfirmationStatus;
}

export type SolanaConfirmationStatus = "confirmed" | "submitted" | "unknown";

export interface SolanaExecutionResult {
  /** Derived locally from the signed transaction, so it survives RPC errors. */
  signature: string;
  confirmationStatus: SolanaConfirmationStatus;
}

/** Accepts base58, a JSON byte array, or raw bytes. */
function toSolanaSecretKey(
  privateKey: string | number[] | Uint8Array,
): Uint8Array {
  if (privateKey instanceof Uint8Array) return privateKey;
  if (Array.isArray(privateKey)) return Uint8Array.from(privateKey);

  const trimmed = privateKey.trim();
  if (trimmed.startsWith("[")) {
    return Uint8Array.from(JSON.parse(trimmed) as number[]);
  }
  // A 64-byte ed25519 secret is at most 88 base58 characters. Bound the
  // attacker-controlled text before the quadratic decoder runs.
  if (trimmed.length > 88) {
    throw new Error("Invalid Solana private key - base58 value is too long");
  }
  return decodeBase58(trimmed);
}

export interface AgentekClientConfig {
  transports: Transport[];
  chains: Chain[];
  accountOrAddress: Account | Address;
  tools: BaseTool[];
  solana?: SolanaConfig;
}

// Type guards for runtime checking
export const isTransactionOp = (op: Operation): op is Op => {
  return 'target' in op && 'value' in op && 'data' in op;
};

export const isPersonalSign = (op: Operation): op is PersonalSign => {
  return 'type' in op && op.type === 'personal_sign';
};

export const isTypedDataSign = (op: Operation): op is TypedDataSign => {
  return 'type' in op && op.type === 'typed_data_sign';
};

export const isSignOperation = (op: Operation): op is Sign => {
  return isPersonalSign(op) || isTypedDataSign(op);
};

export class AgentekClient {
  private publicClients: Map<number, PublicClient<Transport, Chain>>;
  private walletClients: Map<number, WalletClient<Transport, Chain, Account>>;
  private tools: Map<string, BaseTool>;
  private chains: Chain[];
  private accountOrAddress: Account | Address;
  private solanaConfig?: SolanaConfig;
  private solanaConnection?: Connection;
  private solanaKeypair?: Keypair;

  constructor(config: AgentekClientConfig) {
    this.publicClients = new Map();
    this.walletClients = new Map();
    this.chains = config.chains;
    this.accountOrAddress = config.accountOrAddress;
    this.solanaConfig = config.solana;

    config.chains.forEach((chain, index) => {
      const transport = config.transports[index] || config.transports[0];

      // Create public client with simple configuration to avoid type issues
      const publicClient = createPublicClient({
        transport,
        chain,
      });

      this.publicClients.set(chain.id, publicClient as PublicClient<Transport, Chain>);

      // Create wallet client separately if account is provided as an object
      // client.ts (inside constructor)
      if (typeof config.accountOrAddress === "object") {
        const raw = createWalletClient({
          transport,
          chain,
          account: config.accountOrAddress,
        });

        // Force‐cast so TS doesn't expand the full generic return type.
        const walletClient = raw as unknown as WalletClient<Transport, Chain, Account>;

        this.walletClients.set(chain.id, walletClient);
      }
    });

    this.tools = new Map(config.tools.map((tool) => [tool.name, tool]));
  }

  // Get address
  public async getAddress(): Promise<Address> {
    if (typeof this.accountOrAddress === "string") {
      return this.accountOrAddress;
    }
    return this.accountOrAddress.address;
  }

  // Get public client for specific chain
  public getPublicClient(chainId?: number): any { // Use any to avoid type issues
    if (!chainId) {
      const defaultClient = this.publicClients.values().next().value;
      if (!defaultClient) throw new Error("No public clients available");
      return defaultClient;
    }
    const specificClient = this.publicClients.get(chainId);
    if (!specificClient)
      throw new Error(
        `No public client for chain ${chainId}. This client is configured for: ${[
          ...this.publicClients.keys(),
        ].join(", ")}`,
      );
    return specificClient;
  }

  /**
   * Assert this client can actually reach `chainId`.
   *
   * Intent tools that build calldata without touching the chain used to return
   * a complete, signable intent for a chain the client had no transport for —
   * `depositWETH` on Sepolia, say — and only failed once the user had approved
   * it and execution reached `executeOps`. Calling this first turns that into
   * an error at build time.
   */
  public assertChainAvailable(chainId: number): void {
    if (!this.publicClients.has(chainId)) {
      throw new Error(
        `Chain ${chainId} is not configured on this client. Available: ${[
          ...this.publicClients.keys(),
        ].join(", ")}`,
      );
    }
  }

  // Get all public clients
  public getPublicClients(): Map<number, any> {
    return this.publicClients;
  }

  // Get wallet client for specific chain
  public getWalletClient(chainId?: number): WalletClient | undefined {
    if (!chainId) {
      return this.walletClients.values().next().value;
    }
    return this.walletClients.get(chainId);
  }

  // Get all wallet clients
  public getWalletClients(): Map<number, WalletClient> {
    return this.walletClients;
  }

  // Get all available chains
  public getChains(): Chain[] {
    return this.chains;
  }

  // Get all tools
  public getTools(): Map<string, BaseTool> {
    return this.tools;
  }

  // Method to filter supported chains
  public filterSupportedChains(
    supportedChains: Chain[],
    chainId?: number,
  ): Chain[] {
    let chains = this.getChains();
    chains = chains.filter((chain) =>
      supportedChains.map((c) => c.id).includes(chain.id),
    );
    if (chainId !== undefined) {
      chains = chains.filter((chain) => chain.id === chainId);
      if (chains.length === 0) {
        throw new Error(`Chain ${chainId} is not supported`);
      }
    }

    return chains;
  }

  // Method to add new tools
  public addTools(tools: BaseTool[]): void {
    tools.forEach((tool) => {
      this.tools.set(tool.name, tool);
    });
  }

  public async executeOps(ops: Op[], chainId: number): Promise<string> {
    const walletClient = this.getWalletClient(chainId);
    const publicClient = this.getPublicClient(chainId);

    if (!walletClient) {
      throw new Error(`No wallet client available for chain ${chainId}`);
    }

    if (!publicClient) {
      throw new Error(`No public client available for chain ${chainId}`);
    }

    let hash = "";
    for (const [index, op] of ops.entries()) {
      // Remove the explicit account parameter as it's already set in the wallet client
      // @ts-expect-error
      const txHash = await walletClient.sendTransaction({
        to: op.target,
        value: BigInt(op.value),
        data: op.data,
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      // viem resolves for a reverted transaction rather than throwing — the
      // outcome is in receipt.status. Without this check a reverted approval
      // was reported as a successful hash, and the swap that depended on it
      // was still submitted afterwards.
      if (receipt.status !== "success") {
        throw new Error(
          `Transaction ${txHash} reverted on chain ${chainId}` +
            (ops.length > 1 ? ` (operation ${index + 1} of ${ops.length})` : "") +
            `. No further operations in this intent were submitted.`,
        );
      }

      if (ops.length > 1) {
        hash = hash + txHash + ";";
      } else {
        hash = txHash;
      }
    }

    return hash;
  }

  public async executeSign(signs: Sign[], chainId: number): Promise<string[]> {
    const walletClient = this.getWalletClient(chainId);
    const account = await this.getAddress()
    if (!walletClient) {
      throw new Error(`No wallet client available for chain ${chainId}`);
    }

    const signatures: string[] = [];

    for (const sign of signs) {
      let signature: string;

      if (isPersonalSign(sign)) {
        // EIP-191 Personal Sign
        signature = await walletClient.signMessage({
          account,
          message: sign.message as SignableMessage,
        });
      } else if (isTypedDataSign(sign)) {
        // EIP-712 Typed Data Sign
        signature = await walletClient.signTypedData({
          account,
          domain: sign.domain as TypedDataDomain,
          types: sign.types,
          primaryType: sign.primaryType,
          message: sign.message,
        });
      } else {
        throw new Error(`Unsupported sign operation type`);
      }

      signatures.push(signature);
    }

    return signatures;
  }

  // Execute mixed operations (both transactions and signatures)
  public async executeOperations(operations: Operation[], chainId: number): Promise<{
    hash?: string;
    signatures?: string[];
  }> {
    const transactionOps = operations.filter(isTransactionOp);
    const signOps = operations.filter(isSignOperation);

    const results: { hash?: string; signatures?: string[] } = {};

    // Execute transaction operations
    if (transactionOps.length > 0) {
      results.hash = await this.executeOps(transactionOps, chainId);
    }

    // Execute signing operations
    if (signOps.length > 0) {
      results.signatures = await this.executeSign(signOps, chainId);
    }

    return results;
  }

  // ── Solana ───────────────────────────────────────────────────────────
  // Solana sits alongside the viem clients rather than inside them: different
  // key type (ed25519), different transaction model, no chain id. The SDK is
  // imported lazily so EVM-only consumers don't pay for it at startup.

  public getSolanaRpcUrl(): string {
    if (this.solanaConfig?.rpcUrl) return this.solanaConfig.rpcUrl;
    const fromEnv =
      typeof process !== "undefined" ? process.env?.SOLANA_RPC_URL : undefined;
    return fromEnv || DEFAULT_SOLANA_RPC_URL;
  }

  /** Jupiter credentials stay in client configuration, outside model-visible schemas. */
  public getJupiterApiKey(): string | undefined {
    if (this.solanaConfig?.jupiterApiKey) return this.solanaConfig.jupiterApiKey;
    return typeof process !== "undefined"
      ? process.env?.JUPITER_API_KEY
      : undefined;
  }

  public async getSolanaConnection(): Promise<Connection> {
    if (!this.solanaConnection) {
      const { Connection } = await import("@solana/web3.js");
      this.solanaConnection = new Connection(
        this.getSolanaRpcUrl(),
        "confirmed",
      );
    }
    return this.solanaConnection;
  }

  /** The Solana signer, or undefined when the client is watch-only. */
  public async getSolanaKeypair(): Promise<Keypair | undefined> {
    if (this.solanaKeypair) return this.solanaKeypair;

    const privateKey = this.solanaConfig?.privateKey;
    if (!privateKey) return undefined;

    const { Keypair } = await import("@solana/web3.js");
    this.solanaKeypair = Keypair.fromSecretKey(toSolanaSecretKey(privateKey));
    return this.solanaKeypair;
  }

  /** Base58 address of the configured Solana signer, or of the watched account. */
  public async getSolanaAddress(): Promise<string> {
    const keypair = await this.getSolanaKeypair();
    if (keypair) return keypair.publicKey.toBase58();
    if (this.solanaConfig?.address) return this.solanaConfig.address;

    throw new Error(
      "No Solana account configured - pass solana.privateKey to sign transactions, or solana.address for read-only access",
    );
  }

  /** Compile instructions into an unsigned v0 transaction paid for by the configured account. */
  public async buildSolanaTransaction(
    instructions: TransactionInstruction[],
  ): Promise<{
    transaction: VersionedTransaction;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const { PublicKey, TransactionMessage, VersionedTransaction } =
      await import("@solana/web3.js");

    const connection = await this.getSolanaConnection();
    const payerKey = new PublicKey(await this.getSolanaAddress());
    const { blockhash, lastValidBlockHeight } = await this.awaitSolanaPreSubmission(
      connection.getLatestBlockhash(),
      "getLatestBlockhash",
    );

    const message = new TransactionMessage({
      payerKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    return {
      transaction: new VersionedTransaction(message),
      blockhash,
      lastValidBlockHeight,
    };
  }

  /** Bound RPC work before signing, where an ordinary retry is still safe. */
  public async awaitSolanaPreSubmission<T>(
    promise: Promise<T>,
    label: string,
  ): Promise<T> {
    const outcome = await awaitSolanaRpcStage(promise);
    if (outcome.kind === "timeout") {
      throw new Error(
        `Solana RPC ${label} timed out before transaction signing; it is safe to retry`,
      );
    }
    if (outcome.kind === "error") throw outcome.error;
    return outcome.value;
  }

  /** Sign, submit and confirm a Solana transaction. Throws when the client is watch-only. */
  public async executeSolanaTransaction(
    transaction: VersionedTransaction,
    blockhash: string,
    lastValidBlockHeight: number,
  ): Promise<SolanaExecutionResult> {
    const keypair = await this.getSolanaKeypair();
    if (!keypair) {
      throw new Error(
        "No Solana signer available - pass solana.privateKey to send transactions",
      );
    }

    const connection = await this.getSolanaConnection();
    transaction.sign([keypair]);

    // The signature is deterministic and already present locally. Preserve it
    // across every RPC failure so callers can reconcile instead of rebuilding
    // with a new blockhash and accidentally paying twice.
    const signature = encodeBase58(transaction.signatures[0]);

    const executionStartedAt = Date.now();
    const sendOutcome = await awaitSolanaRpcStage(
      connection.sendRawTransaction(
        transaction.serialize(),
        { maxRetries: 3 },
      ),
    );
    if (sendOutcome.kind === "timeout") {
      return { signature, confirmationStatus: "unknown" };
    }
    if (sendOutcome.kind === "error") {
      const { SendTransactionError } = await import("@solana/web3.js");
      if (sendOutcome.error instanceof SendTransactionError) {
        // Simulation/preflight rejection is a definitive non-submission and
        // should remain an actionable error rather than ambiguous success.
        throw sendOutcome.error;
      }
      return { signature, confirmationStatus: "unknown" };
    }
    const rpcSignature = sendOutcome.value;

    if (rpcSignature !== signature) {
      // A conforming RPC returns the transaction's first signature. Treat a
      // mismatch as an ambiguous submission and retain the locally verifiable
      // identity rather than trusting RPC-controlled output.
      return { signature, confirmationStatus: "unknown" };
    }

    const confirmationOutcome = await awaitSolanaRpcStage(
      connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      ),
      Math.max(
        1,
        SOLANA_RPC_OUTCOME_TIMEOUT_MS - (Date.now() - executionStartedAt),
      ),
    );
    if (confirmationOutcome.kind !== "value") {
      return { signature, confirmationStatus: "submitted" };
    }
    const confirmation = confirmationOutcome.value;

    if (confirmation.value.err) {
      throw new Error(
        `Solana transaction ${signature} failed: ${JSON.stringify(confirmation.value.err)}`,
      );
    }

    return { signature, confirmationStatus: "confirmed" };
  }

  public async execute(method: string, args: any): Promise<any> {
    const tool = this.tools.get(method);
    if (!tool) {
      throw new Error(`Tool ${method} not found`);
    }

    // An empty supportedChains means "not chain-specific", which is how every
    // tool that declares one uses it. Read literally it meant "supports no
    // chain", so a chain-agnostic tool rejected any chainId the model passed.
    if (args.chainId && tool.supportedChains?.length) {
      if (!tool.supportedChains.map((c) => c.id).includes(args.chainId)) {
        throw new Error(
          `Chain ${args.chainId} not supported by tool ${method}. Supported: ${tool.supportedChains
            .map((c) => c.id)
            .join(", ")}`,
        );
      }
    }

    const validatedArgs = tool.parameters.safeParse(args);

    if (!validatedArgs.success) {
      throw new Error(JSON.stringify(validatedArgs.error));
    }

    return tool.execute(this, validatedArgs.data);
  }
}

export function createAgentekClient(
  config: AgentekClientConfig,
): AgentekClient {
  return new AgentekClient(config);
}

export function createTool<T extends z.ZodObject<any, any, any, any>>({
  name,
  description,
  parameters,
  execute,
  supportedChains,
}: {
  name: string;
  description: string;
  parameters: T;
  execute: (client: AgentekClient, args: z.infer<T>) => Promise<any>;
  supportedChains?: Chain[];
}): BaseTool {
  return {
    name,
    description,
    parameters,
    execute,
    supportedChains,
  };
}

export function createToolCollection(tools: BaseTool[]): BaseTool[] {
  return tools;
}
