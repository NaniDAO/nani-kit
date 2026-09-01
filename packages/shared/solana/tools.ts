import { z } from "zod";
import { formatUnits } from "viem";
import { AgentekClient, createTool } from "../client.js";
import { clean } from "../utils.js";
import { solanaRpc } from "./rpc.js";
import {
  SOLANA_CLUSTER_URLS,
  SOLANA_MINT_SYMBOLS,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type SolanaCluster,
} from "./constants.js";
import {
  formatLamports,
  resolveSolanaMint,
  solanaAddressSchema,
  solanaSignatureSchema,
} from "./utils.js";

/**
 * Cluster selection is an enum, not a free-form URL. This parameter is filled
 * in by the model, and an arbitrary endpoint would let any read tool POST to
 * a host of the caller's choosing - an internal service, a metadata endpoint -
 * and hand the response back. Private and self-hosted endpoints belong in
 * client configuration (solana.rpcUrl / SOLANA_RPC_URL), which the model does
 * not control.
 */
const clusterParameter = z
  .enum(["mainnet-beta", "devnet", "testnet"])
  .optional()
  .describe(
    "Solana cluster to query. Omit to use the configured endpoint (solana.rpcUrl or SOLANA_RPC_URL), which defaults to mainnet-beta.",
  );

const strictReadParameters = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.object(shape).strict();

/**
 * Private provider endpoints routinely carry the API key in the path or query
 * string, so the resolved URL must never be echoed back to the model. Report
 * the origin, which identifies the node without the credential.
 */
const endpointOrigin = (rpcUrl: string): string => {
  try {
    return new URL(rpcUrl).origin;
  } catch {
    return "invalid endpoint URL";
  }
};

/** Every read tool takes the same escape hatch, so resolve it in one place. */
const endpoint = (client: AgentekClient, cluster?: SolanaCluster): string =>
  cluster ? SOLANA_CLUSTER_URLS[cluster] : client.getSolanaRpcUrl();

export const getSolBalanceTool = createTool({
  name: "getSolBalance",
  description:
    "Get the native SOL balance of a Solana address, in both lamports and SOL.",
  parameters: strictReadParameters({
    address: solanaAddressSchema.describe("Solana wallet address (base58)"),
    cluster: clusterParameter,
  }),
  execute: async (client, args) => {
    const result = await solanaRpc(endpoint(client, args.cluster), "getBalance", [
      args.address,
    ]);

    return clean({
      address: args.address,
      lamports: String(result.value),
      sol: formatLamports(result.value),
      slot: result.context?.slot,
    });
  },
});

export const getSolanaAccountInfoTool = createTool({
  name: "getSolanaAccountInfo",
  description:
    "Get on-chain account info for a Solana address: owning program, lamports, data size, and parsed contents when the owning program is one the RPC can decode.",
  parameters: strictReadParameters({
    address: solanaAddressSchema.describe("Solana account address (base58)"),
    cluster: clusterParameter,
  }),
  execute: async (client, args) => {
    const result = await solanaRpc(
      endpoint(client, args.cluster),
      "getAccountInfo",
      [args.address, { encoding: "jsonParsed" }],
    );

    if (!result?.value) {
      throw new Error(`Account ${args.address} does not exist on-chain`);
    }

    const account = result.value;
    return clean({
      address: args.address,
      owner: account.owner,
      lamports: String(account.lamports),
      sol: formatLamports(account.lamports),
      executable: account.executable,
      rentEpoch: String(account.rentEpoch),
      space: account.space,
      // Only present when the owning program has a jsonParsed decoder.
      parsed: account.data?.parsed ?? null,
    });
  },
});

/** SPL tokens live under two programs; a wallet can hold accounts from both. */
const fetchTokenAccounts = async (rpcUrl: string, owner: string) => {
  const responses = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      solanaRpc(rpcUrl, "getTokenAccountsByOwner", [
        owner,
        { programId },
        { encoding: "jsonParsed" },
      ]),
    ),
  );

  return responses.flatMap((response) => response?.value ?? []);
};

const toTokenBalance = (account: any) => {
  const info = account.account.data.parsed.info;
  return {
    mint: info.mint,
    symbol: SOLANA_MINT_SYMBOLS[info.mint] ?? null,
    tokenAccount: account.pubkey,
    program:
      account.account.owner === TOKEN_2022_PROGRAM_ID ? "token-2022" : "token",
    amount: info.tokenAmount.amount,
    decimals: info.tokenAmount.decimals,
    uiAmount: info.tokenAmount.uiAmountString,
  };
};

export const getSolanaTokenBalancesTool = createTool({
  name: "getSolanaTokenBalances",
  description:
    "List every SPL token balance held by a Solana wallet, across both the Token and Token-2022 programs. Zero balances are hidden unless requested.",
  parameters: strictReadParameters({
    owner: solanaAddressSchema.describe("Solana wallet address (base58)"),
    includeZeroBalances: z
      .boolean()
      .optional()
      .describe("Include token accounts with a zero balance. Defaults to false."),
    cluster: clusterParameter,
  }),
  execute: async (client, args) => {
    const accounts = await fetchTokenAccounts(
      endpoint(client, args.cluster),
      args.owner,
    );

    const balances = accounts
      .map(toTokenBalance)
      .filter((balance) => args.includeZeroBalances || balance.amount !== "0")
      .sort((a, b) => Number(b.uiAmount) - Number(a.uiAmount));

    return clean({ owner: args.owner, count: balances.length, balances });
  },
});

export const getSolanaTokenBalanceTool = createTool({
  name: "getSolanaTokenBalance",
  description:
    "Get a Solana wallet's balance of one SPL token. Accepts a mint address or a known symbol (USDC, USDT, BONK, JUP, WSOL). Sums across token accounts if the wallet holds more than one for that mint.",
  parameters: strictReadParameters({
    owner: solanaAddressSchema.describe("Solana wallet address (base58)"),
    token: z
      .string()
      .describe("SPL token mint address (base58) or a known symbol like 'USDC'"),
    cluster: clusterParameter,
  }),
  execute: async (client, args) => {
    const mint = resolveSolanaMint(args.token);
    const result = await solanaRpc(
      endpoint(client, args.cluster),
      "getTokenAccountsByOwner",
      [args.owner, { mint }, { encoding: "jsonParsed" }],
    );

    const accounts = (result?.value ?? []).map(toTokenBalance);
    if (accounts.length === 0) {
      return clean({
        owner: args.owner,
        mint,
        symbol: SOLANA_MINT_SYMBOLS[mint] ?? null,
        amount: "0",
        uiAmount: "0",
        decimals: null,
        tokenAccounts: [],
      });
    }

    const decimals = accounts[0].decimals;
    const amount = accounts.reduce(
      (total, account) => total + BigInt(account.amount),
      0n,
    );

    return clean({
      owner: args.owner,
      mint,
      symbol: SOLANA_MINT_SYMBOLS[mint] ?? null,
      amount: amount.toString(),
      decimals,
      uiAmount: formatUnits(amount, decimals),
      tokenAccounts: accounts.map((account) => account.tokenAccount),
    });
  },
});

export const getSolanaTokenSupplyTool = createTool({
  name: "getSolanaTokenSupply",
  description:
    "Get the total circulating supply and decimals of an SPL token mint. Accepts a mint address or a known symbol.",
  parameters: strictReadParameters({
    token: z
      .string()
      .describe("SPL token mint address (base58) or a known symbol like 'USDC'"),
    cluster: clusterParameter,
  }),
  execute: async (client, args) => {
    const mint = resolveSolanaMint(args.token);
    const result = await solanaRpc(
      endpoint(client, args.cluster),
      "getTokenSupply",
      [mint],
    );

    return clean({
      mint,
      symbol: SOLANA_MINT_SYMBOLS[mint] ?? null,
      amount: result.value.amount,
      decimals: result.value.decimals,
      uiAmount: result.value.uiAmountString,
    });
  },
});

export const getSolanaTransactionTool = createTool({
  name: "getSolanaTransaction",
  description:
    "Get details of a Solana transaction by signature: success, fee, compute units and its decoded instructions. Pass verbose for the full raw RPC response including logs and balance changes.",
  parameters: strictReadParameters({
    signature: solanaSignatureSchema.describe(
      "Transaction signature (base58, 88 characters)",
    ),
    verbose: z
      .boolean()
      .optional()
      .describe(
        "Return the full raw transaction including logs and pre/post balances. Defaults to false, which returns a summary.",
      ),
    cluster: clusterParameter,
  }),
  execute: async (client, args) => {
    const transaction = await solanaRpc(
      endpoint(client, args.cluster),
      "getTransaction",
      [
        args.signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
      ],
    );

    if (!transaction) {
      throw new Error(
        `Transaction ${args.signature} not found - it may have expired from the RPC's history, or never landed`,
      );
    }

    if (args.verbose) return clean(transaction);

    const instructions = (
      transaction.transaction?.message?.instructions ?? []
    ).map((instruction: any) => ({
      program: instruction.program ?? null,
      programId: instruction.programId,
      type: instruction.parsed?.type ?? null,
      info: instruction.parsed?.info ?? null,
    }));

    const fee = transaction.meta?.fee ?? 0;
    return clean({
      signature: args.signature,
      slot: transaction.slot,
      blockTime: transaction.blockTime ?? null,
      timestamp: transaction.blockTime
        ? new Date(transaction.blockTime * 1000).toISOString()
        : null,
      success: transaction.meta?.err == null,
      err: transaction.meta?.err ?? null,
      fee: String(fee),
      feeSol: formatLamports(fee),
      computeUnitsConsumed: transaction.meta?.computeUnitsConsumed ?? null,
      instructions,
    });
  },
});

export const getSolanaTransactionHistoryTool = createTool({
  name: "getSolanaTransactionHistory",
  description:
    "List recent transaction signatures for a Solana address, newest first. Paginate with the `before` signature.",
  parameters: strictReadParameters({
    address: solanaAddressSchema.describe("Solana address (base58)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe("How many signatures to return (1-1000). Defaults to 10."),
    before: solanaSignatureSchema
      .optional()
      .describe("Return signatures older than this signature, for pagination."),
    cluster: clusterParameter,
  }),
  execute: async (client, args) => {
    const signatures = await solanaRpc(
      endpoint(client, args.cluster),
      "getSignaturesForAddress",
      [args.address, { limit: args.limit ?? 10, before: args.before }],
    );

    return clean({
      address: args.address,
      count: signatures.length,
      transactions: signatures.map((entry: any) => ({
        signature: entry.signature,
        slot: entry.slot,
        blockTime: entry.blockTime ?? null,
        timestamp: entry.blockTime
          ? new Date(entry.blockTime * 1000).toISOString()
          : null,
        success: entry.err == null,
        err: entry.err ?? null,
        memo: entry.memo ?? null,
      })),
    });
  },
});

export const getSolanaBlockTool = createTool({
  name: "getSolanaBlock",
  description:
    "Get a Solana block by slot, or the latest finalized block when no slot is given. Skipped slots are stepped over automatically when searching for the latest.",
  parameters: strictReadParameters({
    slot: z
      .number()
      .int()
      .optional()
      .describe("Slot to fetch. Omit for the latest finalized block."),
    includeTransactions: z
      .boolean()
      .optional()
      .describe("Include the block's transaction signatures. Defaults to false."),
    cluster: clusterParameter,
  }),
  execute: async (client, args) => {
    const rpcUrl = endpoint(client, args.cluster);
    const config = {
      encoding: "jsonParsed",
      maxSupportedTransactionVersion: 0,
      transactionDetails: args.includeTransactions ? "signatures" : "none",
      rewards: false,
    };

    if (args.slot !== undefined) {
      const block = await solanaRpc(rpcUrl, "getBlock", [args.slot, config]);
      if (!block) {
        throw new Error(`Slot ${args.slot} was skipped and has no block`);
      }
      return clean({ slot: args.slot, ...block });
    }

    // Leaders skip slots routinely, so walk back until a block materialises.
    let slot: number = await solanaRpc(rpcUrl, "getSlot", [
      { commitment: "finalized" },
    ]);

    for (let attempt = 0; attempt < 10; attempt++) {
      const block = await solanaRpc(rpcUrl, "getBlock", [slot, config]).catch(
        () => null,
      );
      if (block) return clean({ slot, ...block });
      slot -= 1;
    }

    throw new Error(
      `No block found in the 10 slots at or below ${slot + 10} - the RPC may be lagging or pruning`,
    );
  },
});

export const getSolanaNetworkStatusTool = createTool({
  name: "getSolanaNetworkStatus",
  description:
    "Get Solana network status from the RPC: health, node version, current slot, block height and epoch progress.",
  parameters: strictReadParameters({ cluster: clusterParameter }),
  execute: async (client, args) => {
    const rpcUrl = endpoint(client, args.cluster);

    // getHealth throws when the node is behind, which is itself the answer.
    const [health, version, epochInfo] = await Promise.all([
      solanaRpc(rpcUrl, "getHealth").catch(
        (error: Error) => `unhealthy: ${error.message}`,
      ),
      solanaRpc(rpcUrl, "getVersion"),
      solanaRpc(rpcUrl, "getEpochInfo"),
    ]);

    return clean({
      // Origin only - the full URL may carry a provider API key.
      rpcUrl: endpointOrigin(rpcUrl),
      health,
      solanaCore: version["solana-core"],
      featureSet: version["feature-set"],
      slot: epochInfo.absoluteSlot,
      blockHeight: epochInfo.blockHeight,
      epoch: epochInfo.epoch,
      slotIndex: epochInfo.slotIndex,
      slotsInEpoch: epochInfo.slotsInEpoch,
      epochProgress: `${((epochInfo.slotIndex / epochInfo.slotsInEpoch) * 100).toFixed(2)}%`,
    });
  },
});

const percentile = (sorted: number[], fraction: number): number =>
  sorted.length === 0
    ? 0
    : sorted[
        Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
      ];

export const getSolanaPriorityFeesTool = createTool({
  name: "getSolanaPriorityFees",
  description:
    "Get recent Solana priority fees in micro-lamports per compute unit, summarised as percentiles. Use `recommended` as the priorityFeeMicroLamports for a transfer.",
  parameters: strictReadParameters({
    accounts: z
      .array(z.string())
      .optional()
      .describe(
        "Accounts the transaction will write to. Fees are contention-specific, so passing these gives a far better estimate.",
      ),
    cluster: clusterParameter,
  }),
  execute: async (client, args) => {
    const fees = await solanaRpc(
      endpoint(client, args.cluster),
      "getRecentPrioritizationFees",
      args.accounts?.length ? [args.accounts] : [],
    );

    const sorted = fees
      .map((entry: any) => entry.prioritizationFee as number)
      .sort((a: number, b: number) => a - b);

    return clean({
      unit: "microLamports per compute unit",
      sampleSlots: sorted.length,
      min: sorted[0] ?? 0,
      median: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
      p95: percentile(sorted, 0.95),
      max: sorted[sorted.length - 1] ?? 0,
      recommended: percentile(sorted, 0.75),
    });
  },
});
