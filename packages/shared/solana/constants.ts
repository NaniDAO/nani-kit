/** Public JSON-RPC endpoints. Heavily rate limited — set SOLANA_RPC_URL for real use. */
export const SOLANA_CLUSTER_URLS = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
} as const;

export type SolanaCluster = keyof typeof SOLANA_CLUSTER_URLS;

export const DEFAULT_SOLANA_CLUSTER: SolanaCluster = "mainnet-beta";
export const DEFAULT_SOLANA_RPC_URL = SOLANA_CLUSTER_URLS[DEFAULT_SOLANA_CLUSTER];

export const SOL_DECIMALS = 9;

export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Mainnet mints agents can name by symbol instead of pasting base58. */
// "SOL" is deliberately absent: it would silently resolve to wrapped SOL and
// answer a question about native SOL with the wrong number. Use getSolBalance
// or intentTransferSol for native SOL.
export const SOLANA_TOKENS: Record<string, string> = {
  WSOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
};

/** Reverse lookup so balance listings can label the mints we know. */
export const SOLANA_MINT_SYMBOLS: Record<string, string> = {
  "So11111111111111111111111111111111111111112": "WSOL",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": "BONK",
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": "JUP",
};
