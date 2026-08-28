# Agentek CLI — Getting Started Guide

This guide walks you through everything you need to do after installing the Agentek CLI to make it work properly.

## 1. Installation

```bash
# Install globally
npm install -g @agentek/cli

# Or run directly with npx (no install required)
npx @agentek/cli <command>
```

Verify the installation:

```bash
agentek --version
```

**Requirements:** Node.js >= 18.17.0

## 2. Check Configuration Status

Run `setup` to see which API keys are configured and which are missing:

```bash
agentek setup
```

This prints a status table showing all 14 known keys. No keys are required to get started — the CLI works with read-only blockchain tools out of the box.

## 3. Configure API Keys

Keys can be stored in two ways. Environment variables always take precedence over config file values.

### Option A: Config file (recommended for personal use)

```bash
agentek config set <KEY> <VALUE>
```

Keys are saved to `~/.agentek/config.json` with restrictive file permissions (0600). Override the config directory by setting `AGENTEK_CONFIG_DIR`.

### Option B: Environment variables

```bash
export PERPLEXITY_API_KEY=pplx-xxxxxxxxxxxxx
```

### Key reference

Below is every key the CLI recognizes, grouped by the tools they unlock.

#### Blockchain (transaction signing)

| Key | Description | How to get it |
|-----|-------------|---------------|
| `PRIVATE_KEY` | Hex-encoded private key for signing transactions | Export from your wallet (MetaMask: Account Details > Export Private Key). **Never share this key.** |
| `ACCOUNT` | Hex address for read-only sender context | Your public wallet address (0x...). Use this instead of `PRIVATE_KEY` if you only need read operations. |
| `SOLANA_PRIVATE_KEY` | Solana secret key for signing Solana transactions | Export from your wallet (Phantom: Settings > Export Private Key) as base58, or use the JSON array `solana-keygen` writes. **Never share this key.** |
| `SOLANA_ACCOUNT` | Base58 Solana address for read-only sender context | Your Solana public address. Use this instead of `SOLANA_PRIVATE_KEY` if you only need read operations. |
| `SOLANA_RPC_URL` | Solana JSON-RPC endpoint | Defaults to the public mainnet-beta endpoint, which is heavily rate limited. Point it at your own endpoint for real use. |
| `JUPITER_API_KEY` | Optional Jupiter Tokens V2 and Swap V2 API key | Keyless requests use Jupiter's prototype rate limit. Configure a portal key for higher production limits and analytics; it stays outside tool arguments. |

**Security note:** If you only need to read data (balances, prices, ENS lookups), you do not need `PRIVATE_KEY`. Set `ACCOUNT` to your public address instead. Only configure `PRIVATE_KEY` when you need to sign and send transactions (swaps, transfers, approvals).

#### Search and AI

| Key | Description | How to get it |
|-----|-------------|---------------|
| `PERPLEXITY_API_KEY` | Perplexity AI search tools | Sign up at [perplexity.ai](https://www.perplexity.ai), go to API settings, create an API key |
| `FIREWORKS_API_KEY` | Fireworks AI image generation | Sign up at [fireworks.ai](https://fireworks.ai), go to API Keys in the dashboard |

#### DEX and Swaps

| Key | Description | How to get it |
|-----|-------------|---------------|
| `ZEROX_API_KEY` | 0x swap and quote tools | Sign up at [0x.org/dashboard](https://dashboard.0x.org), create an app, copy the API key |

#### Governance

| Key | Description | How to get it |
|-----|-------------|---------------|
| `TALLY_API_KEY` | Tally governance tools | Sign up at [tally.xyz](https://www.tally.xyz), go to Settings > API, generate a key |

#### Market Data

| Key | Description | How to get it |
|-----|-------------|---------------|
| `COINDESK_API_KEY` | CoinDesk news and data tools | Apply at [coindesk.com/arc/api](https://www.coindesk.com/arc/api) |
| `COINMARKETCAL_API_KEY` | CoinMarketCal event tools | Sign up at [coinmarketcal.com/en/api](https://coinmarketcal.com/en/api) |

#### IPFS

| Key | Description | How to get it |
|-----|-------------|---------------|
| `PINATA_JWT` | Pinata IPFS pinning (used with image generation) | Sign up at [pinata.cloud](https://www.pinata.cloud), go to API Keys, create a new key with pinning permissions |

#### X / Twitter

All four keys are needed together for full Twitter functionality. `X_BEARER_TOKEN` alone enables read-only access (searching tweets, viewing profiles).

| Key | Description | How to get it |
|-----|-------------|---------------|
| `X_BEARER_TOKEN` | Read-only access to X/Twitter | Create a project at [developer.x.com](https://developer.x.com), copy the Bearer Token |
| `X_API_KEY` | OAuth application key | Same project > Keys and Tokens > API Key |
| `X_API_KEY_SECRET` | OAuth application secret | Same project > Keys and Tokens > API Key Secret |
| `X_ACCESS_TOKEN` | OAuth user access token | Same project > Keys and Tokens > Access Token |
| `X_ACCESS_TOKEN_SECRET` | OAuth user access token secret | Same project > Keys and Tokens > Access Token Secret |

### Example: minimal setup for common use cases

**Read-only blockchain + search:**

```bash
agentek config set ACCOUNT 0xYourAddressHere
agentek config set PERPLEXITY_API_KEY pplx-xxxxxxxxxxxxx
```

**Full blockchain interaction + swaps:**

```bash
agentek config set PRIVATE_KEY 0xYourPrivateKeyHere
agentek config set ZEROX_API_KEY your-0x-api-key
```

### Managing keys

```bash
# View a key (redacted by default)
agentek config get PERPLEXITY_API_KEY

# View the full key value
agentek config get PERPLEXITY_API_KEY --reveal

# List all keys with their status
agentek config list

# Delete a key
agentek config delete PERPLEXITY_API_KEY
```

## 4. Discover Tools

The CLI comes with 150+ blockchain and data tools. Use these commands to explore them.

### List all tools

```bash
agentek list
```

Returns a sorted JSON array of all tool names.

### Search by keyword

```bash
agentek search balance
agentek search swap
agentek search ens
agentek search governance
```

Returns matching tools with their descriptions.

### Inspect a tool

```bash
agentek info getBalance
```

Returns the tool's description, full parameter schema (JSON Schema format), and supported chains.

## 5. Execute Tools

### Basic syntax

```bash
agentek exec <tool-name> --param1 value1 --param2 value2
```

All output is JSON on stdout. Errors are JSON on stderr.

### Examples

**Get the latest block number:**

```bash
agentek exec getBlockNumber --chainId 1
```

**Check an ETH balance:**

```bash
agentek exec getBalance \
  --address 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 \
  --chainId 1
```

**Resolve an ENS name:**

```bash
agentek exec getEnsAddress --name vitalik.eth --chainId 1
```

**Get ERC-20 token balance:**

```bash
agentek exec getBalanceOf \
  --tokenAddress 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  --address 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 \
  --chainId 1
```

**Search for crypto prices:**

```bash
agentek exec getCryptoPrice --coinId ethereum
```

**Get DeFi protocol TVL:**

```bash
agentek exec getProtocolTvl --protocol aave
```

### Chain IDs

The CLI supports five chains:

| Chain | ID |
|-------|----|
| Ethereum | 1 |
| Optimism | 10 |
| Arbitrum | 42161 |
| Polygon | 137 |
| Base | 8453 |

### Advanced flag syntax

```bash
# Inline value with =
agentek exec getBalance --address=0x... --chainId=1

# Boolean flags (no value needed)
agentek exec someToolName --verbose

# Array parameters (repeat the flag)
agentek exec someToolName --addresses 0xabc --addresses 0xdef

# Raw JSON injection
agentek exec someToolName --json '{"address":"0x...","chainId":1}'

# Custom timeout (default is 120 seconds)
agentek exec getBalance --address 0x... --chainId 1 --timeout 60000
```

### Handling errors

The CLI returns structured JSON errors with codes and hints:

- `UNKNOWN_TOOL` — tool not found, may include a "Did you mean?" suggestion
- `MISSING_API_KEY` — tool requires an API key, includes `config set` instructions
- `VALIDATION_ERROR` — wrong or missing parameters, suggests running `agentek info <tool>`
- `CHAIN_NOT_SUPPORTED` — lists the tool's supported chains
- `TIMEOUT` — suggests a longer `--timeout` value
- `EXECUTION_ERROR` — generic runtime error

## 6. Scripting and Piping

The CLI is designed for programmatic use. All successful output is valid JSON on stdout, making it easy to pipe through `jq` or consume from scripts.

```bash
# Get a balance and extract the value with jq
agentek exec getBalance --address 0x... --chainId 1 | jq '.balance'

# List tools matching "price" and count them
agentek search price | jq 'length'

# Use in a shell script
BLOCK=$(agentek exec getBlockNumber --chainId 1 | jq -r '.')
echo "Current block: $BLOCK"
```

## 7. Using with Claude Code (MCP)

The Agentek MCP server exposes all tools to Claude Code and other MCP-compatible clients.

### Install the MCP server

```bash
npm install -g @agentek/mcp-server
```

### Configure Claude Desktop

Add to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "agentek": {
      "command": "npx",
      "args": ["-y", "@agentek/mcp-server"],
      "env": {
        "ACCOUNT": "0xYourAddressHere",
        "PERPLEXITY_API_KEY": "pplx-xxxxxxxxxxxxx"
      }
    }
  }
}
```

Add any additional API keys to the `env` block as needed. Restart Claude Desktop after editing.

## 8. Using as a Library

For programmatic integration with AI frameworks, use the companion packages:

### Vercel AI SDK

```bash
npm install @agentek/ai-sdk @agentek/tools viem zod
```

```typescript
import { AgentekToolkit } from "@agentek/ai-sdk";
import { allTools, createAgentekClient } from "@agentek/tools";
import { http } from "viem";
import { mainnet } from "viem/chains";

const client = createAgentekClient({
  transports: [http()],
  chains: [mainnet],
  accountOrAddress: "0xYourAddress",
  tools: await allTools(),
});

const toolkit = new AgentekToolkit({ client });
// Use toolkit.tools() with generateText/streamText
```

## 9. Troubleshooting

### "Command not found: agentek"

The global npm bin directory is not in your PATH. Fix with:

```bash
# Find the bin directory
npm config get prefix

# Add to your shell profile (~/.bashrc, ~/.zshrc, etc.)
export PATH="$(npm config get prefix)/bin:$PATH"
```

Or use `npx @agentek/cli` instead.

### "Invalid PRIVATE_KEY format, must be hex"

Your private key must be a hex string starting with `0x`. Example: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

### Tool execution times out

Some tools (e.g., those hitting public RPCs) may be slow. Increase the timeout:

```bash
agentek exec slowTool --param value --timeout 300000
```

### "MISSING_API_KEY" error

The tool requires an API key that is not configured. The error message tells you exactly which key to set:

```bash
agentek config set ZEROX_API_KEY your-key-here
```

### Config file location

Default: `~/.agentek/config.json`

Override with the `AGENTEK_CONFIG_DIR` environment variable:

```bash
export AGENTEK_CONFIG_DIR=/custom/path
agentek config set KEY value   # saves to /custom/path/config.json
```

### Verifying your setup

```bash
# Check all keys at once
agentek setup

# Test a read-only tool (no keys required)
agentek exec getBlockNumber --chainId 1

# Test search (requires PERPLEXITY_API_KEY)
agentek exec askPerplexitySearch --query "What is Ethereum?"
```

## 10. Supported Tool Categories

| Category | Example tools | Keys needed |
|----------|--------------|-------------|
| RPC (blocks, balances, transactions) | `getBalance`, `getBlockNumber`, `getTransactionReceipt` | None |
| ENS | `getEnsAddress`, `getEnsName` | None |
| ERC-20 tokens | `getBalanceOf`, `getAllowance`, `intentApprove`, `intentTransfer` | `PRIVATE_KEY` for intents |
| ERC-721 NFTs | `getNFTBalance`, `getNFTOwner` | None |
| Crypto prices | `getCryptoPrice`, `getCryptoPrices` | None |
| DeFi (Aave, Uniswap, DeFiLlama) | `getProtocolTvl`, `getYieldPools` | None |
| DEX data (DexScreener) | `getTrendingTokens` | None |
| Swaps (0x) | `intent0xSwap` | `ZEROX_API_KEY` + `PRIVATE_KEY` |
| Cross-chain bridge (Across) | `intentAcrossBridge` | `PRIVATE_KEY` |
| Search (Perplexity) | `askPerplexitySearch` | `PERPLEXITY_API_KEY` |
| Governance (Tally) | `tallyProposals`, `intentGovernorVote` | `TALLY_API_KEY` |
| Market data | `getLatestCoindeskNewsTool`, `getMarketEvents` | `COINDESK_API_KEY`, `COINMARKETCAL_API_KEY` |
| Image generation | `generateAndPinImage` | `FIREWORKS_API_KEY` + `PINATA_JWT` |
| Twitter/X | `searchRecentTweets`, `getXUserByUsername` | `X_BEARER_TOKEN` |
| Fear & Greed Index | `getFearGreedIndex` | None |
| Gas estimation | `estimateGas` | None |
| Web scraping | `webGetTool` | None |
| Security checks | `checkSecurity` | None |
