# Agentek Tools

A comprehensive collection of blockchain and web tools designed for AI agents. This package provides over 100 tools to interact with Ethereum and EVM-compatible networks, enabling AI systems to perform blockchain operations, access DeFi protocols, and retrieve crypto market data.

## ✨ Features

- **Extensive Tool Collection**: Over 100 blockchain and web tools
- **Modular Architecture**: Tools are organized by functionality
- **Type Safety**: Full TypeScript support with strict typing
- **Chain Agnostic**: Works with multiple EVM-compatible networks
- **Parameter Validation**: Uses Zod for robust parameter validation
- **DeFi Ready**: Integration with Uniswap, Aave, and other protocols
- **AI Integration**: Designed for use with AI systems

## 🚀 Installation

```bash
# npm
npm install @agentek/tools

# pnpm
pnpm add @agentek/tools

# yarn
yarn add @agentek/tools
```

## 📋 Requirements

- Node.js >= 18.17.0 (Required for proper fetch API support)

## 🧰 Available Tools

The package includes tools for:

- **Tokens**: ERC20, WETH, and NFT operations
- **DeFi**: Trading, lending, and yield information
- **Identity**: ENS domain resolution and lookup
- **Data**: Price feeds, block explorers, and market data
- **Contract research**: One `researchCA` call for deterministic token/NFT identity, supply, holder concentration, bounded mint history, verified ABI privileges, and pool activity
- **Security**: Address and transaction security checks
- **Governance**: DAO voting and proposal information
- **Web**: Basic web browsing and search tools

## 🔧 Usage

```typescript
import { allTools } from '@agentek/tools';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

// Initialize the tools
const tools = allTools({
  // Optional API keys for additional functionality
  perplexityApiKey: process.env.PERPLEXITY_API_KEY,
  zeroxApiKey: process.env.ZEROX_API_KEY,
  // ...other API keys
});

// Create a client to use the tools
const client = new AgentekClient({
  transports: [http('https://ethereum.publicnode.com')],
  chains: [mainnet],
  accountOrAddress: '0xYourAddress',
  tools: tools,
});

// Execute a tool
const balance = await client.execute('getEthBalance', {
  address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
});
console.log(`Balance: ${balance} ETH`);
```

## 🏗️ Creating Custom Tools

Tools follow a standardized pattern:

```typescript
import { z } from 'zod';
import { createTool } from '@agentek/tools/client';

const myCustomTool = createTool({
  name: 'myCustomTool',
  description: 'Does something useful',
  parameters: z.object({
    param1: z.string().describe('Description of param1'),
    param2: z.number().optional().describe('Optional parameter'),
  }),
  execute: async (client, args) => {
    // Tool implementation
    return { result: 'Success!' };
  },
});
```

## 📚 Documentation

For more detailed documentation and examples, see the [official documentation](https://github.com/NaniDAO/agentek).

## 📄 License

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.en.html)
