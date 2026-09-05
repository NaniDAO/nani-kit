# agentek

![agentek-logo-1](https://github.com/user-attachments/assets/c73ccd7b-4c4e-4c90-8ccc-1ed101fa1b0b)

An extensible TypeScript toolkit for EVM and Solana blockchain interactions. 177 composable tools covering on-chain actions, DeFi protocols, market data, and off-chain services — designed for AI agents, MCP clients, and developers.

## Quick Start

Requires Node.js 20.18.1 or newer.

**CLI** (fastest way to try it):
```bash
npx @agentek/cli list          # browse up to 177 tools
npx @agentek/cli info getBalance  # inspect a specific tool
npx @agentek/cli exec getBalance '{"chainId":1,"address":"vitalik.eth"}'
```

**MCP Server** (for Claude Desktop, Cursor, etc.):
```bash
pnpx @agentek/mcp-server
```

**TypeScript SDK**:
```bash
pnpm add @agentek/tools
```

## Packages

| Package | Description | Version |
|---------|-------------|---------|
| [`@agentek/tools`](packages/shared) | Core toolkit — up to 177 tools | 0.1.26 |
| [`@agentek/ai-sdk`](packages/ai-sdk) | Vercel AI SDK integration | 0.1.26 |
| [`@agentek/mcp-server`](packages/mcp) | Model Context Protocol server | 0.1.26 |
| [`@agentek/cli`](packages/cli) | Command-line interface | 0.0.2 |

## Requirements

- Node.js >= 18.17.0
- pnpm (for development)

## Installation

```bash
# Core tools
pnpm add @agentek/tools viem zod

# Vercel AI SDK integration
pnpm add @agentek/ai-sdk @agentek/tools viem zod
```

## Usage

### Using with Vercel AI SDK

```typescript
import { allTools } from '@agentek/tools';
import { AgentekToolkit } from '@agentek/ai-sdk';
import { http } from 'viem';
import { mainnet } from 'viem/chains';

const tools = await allTools({
  perplexityApiKey: process.env.PERPLEXITY_API_KEY,
  zeroxApiKey: process.env.ZEROX_API_KEY,
});

const toolkit = new AgentekToolkit({
  accountOrAddress: '0x...',
  chains: [mainnet],
  transports: [http()],
  tools,
});

// Pass to Vercel AI SDK
const aiTools = toolkit.getTools();
```

### Using the toolkit directly

```typescript
import { createAgentekClient, allTools } from '@agentek/tools';
import { http } from 'viem';
import { mainnet } from 'viem/chains';

const tools = await allTools({});

const client = createAgentekClient({
  accountOrAddress: '0x...',
  chains: [mainnet],
  transports: [http()],
  tools,
});

const result = await client.execute('getBalance', {
  address: '0x...',
  chainId: 1,
});
```

### Using the MCP Server

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentek": {
      "command": "pnpx",
      "args": ["@agentek/mcp-server"],
      "env": {
        "ACCOUNT": "YOUR_ETHEREUM_ADDRESS",
        "PERPLEXITY_API_KEY": "...",
        "TALLY_API_KEY": "..."
      }
    }
  }
}
```

Use `ACCOUNT` for read-only access. Add `PRIVATE_KEY` only if you need to execute transactions.

See the [MCP Server README](packages/mcp/README.md) for full configuration details.

### Using the CLI

```bash
# List all available tools
npx @agentek/cli list

# Search for tools by keyword
npx @agentek/cli search "swap"

# Get detailed info about a tool
npx @agentek/cli info intentApprove

# Execute a tool
npx @agentek/cli exec getCryptoPrice '{"coinId":"ethereum"}'
```

See the [CLI Guide](packages/cli/GUIDE.md) for complete documentation.

### Composing a custom tool set

You don't have to use all 177 tools. Import only what you need:

```typescript
import { rpcTools, erc20Tools, defillamaTools } from '@agentek/tools';

const tools = [
  ...rpcTools(),
  ...erc20Tools(),
  ...defillamaTools(),
];
```

## Tools (177 total)

### Blockchain Core

| Module | Tools | Description |
|--------|-------|-------------|
| **rpc** | 11 | `getBalance`, `getBlock`, `getBlockNumber`, `getGasPrice`, `getTransaction`, `getTransactionReceipt`, `getCode`, `getTransactionCount`, `estimateGas`, `getFeeHistory`, `intentSendTransaction` |
| **erc20** | 8 | `getBalanceOf`, `getAllowance`, `getTotalSupply`, `getDecimals`, `getName`, `getSymbol`, `getTokenMetadata`, `intentApprove` |
| **transfer** | 2 | `intentTransfer`, `intentTransferFrom` |
| **erc721** | 1 | `getNFTMetadata` |
| **erc6909** | 3 | Token balance, metadata, and transfer intents |
| **ens** | 2 | `resolveENS`, `lookupENS` |
| **wns** | 19 | `resolveWNS`, `isAvailableWNS`, `intentRegisterWNS`, and 16 more naming tools |

### DeFi

| Module | Tools | Description |
|--------|-------|-------------|
| **aave** | 6 | Lending/borrowing: `getAaveUserData`, `getAaveReserveData`, deposit, withdraw, borrow, repay intents |
| **uniV3** | 9 | Liquidity: `getUniV3Pool`, `getUserPositions`, `getPoolFeeData`, mint/increase/decrease/collect/transfer intents |
| **swap** | 1 | `intent0xSwap` — token swaps via 0x aggregator |
| **weth** | 2 | `depositWETH`, `withdrawWETH` |
| **zamm** | 5 | `getPool`, `getSwaps`, `getAccountPortfolio`, and swap/liquidity tools |
| **zrouter** | 2 | `getQuote`, `swap` — cross-DEX routing |
| **x402** | 3 | `x402Fetch`, `getX402PaymentInfo`, `x402DiscoverResources` — HTTP 402 payments |
| **defillama** | 5 | `getYieldTool`, `compareYieldTool`, `getYieldHistoryTool`, `compareYieldHistoryTool`, `getTokenChart` |

### Cross-Chain

| Module | Tools | Description |
|--------|-------|-------------|
| **across** | 2 | `getAcrossFeeQuote`, `intentDepositAcross` |
| **slowTransfer** | 12 | Slow-release transfers with guardian controls |

### Market Data

| Module | Tools | Description |
|--------|-------|-------------|
| **dexscreener** | 1 | `getLatestTokens` — trending token discovery |
| **researchCA** | 1 | `researchCA` — aggregate EVM contract, token/NFT, holder, mint-history, privilege, and pool diligence with explicit data-completeness qualifiers |
| **cryptoprices** | 1 | `getCryptoPrice` — current prices via CoinGecko |
| **coindesk** | 1 | `getLatestCoindeskNewsTool` — crypto news |
| **coinmarketcal** | 1 | `getMarketEvents` — upcoming market events |
| **feargreed** | 1 | `getFearAndGreedIndex` |
| **gasestimator** | 1 | `estimateGasCost` — gas cost in USD |

### Block Explorer (Blockscout)

33 tools covering addresses, transactions, blocks, tokens, smart contracts, and search across supported networks.

### Governance

| Module | Tools | Description |
|--------|-------|-------------|
| **tally** | 5 | `tallyProposals`, `tallyChains`, `tallyUserDaos`, `intentGovernorVote`, `intentGovernorVoteWithReason` |
| **nani** | 5 | `getNaniProposals`, `intentStakeNani`, `intentUnstakeNani`, `intentProposeNani`, `intentVoteNaniProposal` |
| **coinchan** | 8 | Coin creation, vesting, airdrops |

### Social & Web

| Module | Tools | Description |
|--------|-------|-------------|
| **twitter** | 5 | `searchRecentTweets`, `getTweetById`, `getXUserByUsername`, `getXUserTweets`, `getHomeTimeline` |
| **web** | 1 | `scrapeWebContent` |
| **search** | 1 | `askPerplexitySearch` |
| **imagegen** | 1 | `generateAndPinImage` — AI image generation + IPFS pinning |

### Security & Utility

| Module | Tools | Description |
|--------|-------|-------------|
| **security** | 2 | `checkMaliciousAddress`, `checkMaliciousWebsite` |
| **btc-rpc** | 4 | `getBtcAddressInfo`, `getBtcTxDetails`, `getBtcBlockTxids`, `getLatestBtcBlock` |
| **think** | 1 | Reasoning step for multi-step agent workflows |

### Solana

| Module | Tools | Description |
|--------|-------|-------------|
| **solana** | 21 | `getSolBalance`, `getSolanaAccountInfo`, `getSolanaTokenBalances`, `getSolanaTokenBalance`, `getSolanaTokenSupply`, `getSolanaTransaction`, `getSolanaTransactionHistory`, `getSolanaBlock`, `getSolanaNetworkStatus`, `getSolanaPriorityFees`, `intentTransferSol`, `intentTransferSplToken`, `searchSolanaTokens`, `getSolanaTrendingTokens`, `getSolanaRecentTokens`, `getSolanaTokenMarketData`, `getSolanaLatestProfiles`, `getSolanaPromotedTokens`, `getSolanaTokenPairs`, `getSolanaSwapQuote`, `intentSwapSolana` |

## Supported Networks

**EVM**

- Ethereum Mainnet
- Optimism
- Arbitrum
- Polygon
- Base

**Solana**

- Mainnet-beta by default. Tools take a `cluster` parameter (`mainnet-beta`, `devnet`,
  `testnet`) to switch cluster; a private or self-hosted endpoint is configured once
  via `SOLANA_RPC_URL` or `solana.rpcUrl` rather than passed per call.

## Solana

Solana tools sit alongside the EVM ones and share the same client. Reads work
with no configuration at all. Writes need a key, which lives in its own
`solana` config block because Solana uses ed25519 keys rather than secp256k1:

```typescript
import { createAgentekClient, allTools } from '@agentek/tools';

const client = createAgentekClient({
  accountOrAddress: '0x...',
  chains: [mainnet],
  transports: [http()],
  tools: await allTools({}),
  solana: {
    // A base58 secret key (Phantom export), a JSON byte array
    // (solana-keygen), or the raw 64 bytes.
    privateKey: process.env.SOLANA_PRIVATE_KEY,
    rpcUrl: process.env.SOLANA_RPC_URL,
    jupiterApiKey: process.env.JUPITER_API_KEY,
  },
});

await client.execute('getSolBalance', {
  address: '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9',
});
```

SOL and SPL transfer intent tools mirror the EVM ones: with a key configured
they sign, submit and confirm, returning the signature. Without one, pass
`solana.address` instead and they return the unsigned transaction as base64
for you to sign elsewhere. `intentSwapSolana` always returns Jupiter's
untrusted transaction and request ID for an external wallet to decode,
validate, simulate, approve, sign, and execute; agentek never signs or submits
a Jupiter swap intent:

```json
{
  "intent": "send 0.25 SOL to 5tzFki...",
  "chain": "solana",
  "transaction": "AQAAAAAA...",
  "signature": "4pF2s..."
}
```

The public mainnet-beta endpoint is heavily rate limited — set
`SOLANA_RPC_URL` to your own endpoint for anything beyond casual use.

## Environment Variables

Most tools work without any API keys. Optional keys unlock additional features.

EVM tools fall back to public RPC endpoints, which are shared and rate limited —
point `RPC_URLS` (or the per-chain variables) at your own provider for anything
beyond casual use.

| Variable | Required for |
|----------|-------------|
| `PRIVATE_KEY` | Executing transactions (intent tools) |
| `ACCOUNT` | Read-only address context (alternative to PRIVATE_KEY) |
| `SOLANA_PRIVATE_KEY` | Signing Solana transactions (base58 or JSON byte array) |
| `SOLANA_ACCOUNT` | Read-only Solana address (alternative to SOLANA_PRIVATE_KEY) |
| `SOLANA_RPC_URL` | Solana JSON-RPC endpoint (defaults to public mainnet-beta) |
| `RPC_URLS` | EVM endpoints as a `chainId=url` list, e.g. `1=https://…,8453=https://…` |
| `RPC_URL_<chainId>` | EVM endpoint for one chain, e.g. `RPC_URL_1` |
| `ETHEREUM_RPC_URL` and friends | Per-chain aliases: `OPTIMISM_`, `ARBITRUM_`, `POLYGON_`, `BASE_`, `MODE_`, `SEPOLIA_` |
| `JUPITER_API_KEY` | Higher Jupiter Tokens V2 and Swap V2 rate limits and analytics (keyless access is supported) |
| `PERPLEXITY_API_KEY` | AI-powered search |
| `ZEROX_API_KEY` | Token swaps via 0x |
| `TALLY_API_KEY` | Governance data |
| `COINDESK_API_KEY` | Crypto news |
| `COINMARKETCAL_API_KEY` | Market events calendar |
| `FIREWORKS_API_KEY` | AI image generation |
| `PINATA_JWT` | IPFS pinning (paired with FIREWORKS_API_KEY) |
| `X_BEARER_TOKEN` | Twitter/X read-only access |
| `X_API_KEY` + `X_API_KEY_SECRET` | Twitter/X OAuth (full access) |

Copy the example to get started:
```bash
cp .env.example .env
```

## Development

```bash
git clone https://github.com/NaniDAO/agentek.git
cd agentek
pnpm i
pnpm run build
pnpm run test
```

Interested in contributing? Check out our [CONTRIBUTING.md](CONTRIBUTING.md) guide.

## License

[AGPL-3.0](LICENSE)
