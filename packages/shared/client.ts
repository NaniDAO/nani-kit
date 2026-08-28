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
import { decodeBase58 } from "./solana/base58.js";

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
      throw new Error(`No public client for chain ${chainId}`);
    return specificClient;
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
    for (const op of ops) {
      // Remove the explicit account parameter as it's already set in the wallet client
      // @ts-expect-error
      const txHash = await walletClient.sendTransaction({
        to: op.target,
        value: BigInt(op.value),
        data: op.data,
      });

      await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

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
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

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

  /** Sign, submit and confirm a Solana transaction. Throws when the client is watch-only. */
  public async executeSolanaTransaction(
    transaction: VersionedTransaction,
    blockhash: string,
    lastValidBlockHeight: number,
  ): Promise<string> {
    const keypair = await this.getSolanaKeypair();
    if (!keypair) {
      throw new Error(
        "No Solana signer available - pass solana.privateKey to send transactions",
      );
    }

    const connection = await this.getSolanaConnection();
    transaction.sign([keypair]);

    const signature = await connection.sendRawTransaction(
      transaction.serialize(),
      { maxRetries: 3 },
    );

    const confirmation = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );

    if (confirmation.value.err) {
      throw new Error(
        `Solana transaction ${signature} failed: ${JSON.stringify(confirmation.value.err)}`,
      );
    }

    return signature;
  }

  public async execute(method: string, args: any): Promise<any> {
    const tool = this.tools.get(method);
    if (!tool) {
      throw new Error(`Tool ${method} not found`);
    }

    if (args.chainId && tool.supportedChains) {
      if (!tool.supportedChains.map((c) => c.id).includes(args.chainId)) {
        throw new Error(
          `Chain ${args.chainId} not supported by tool ${method}`,
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
