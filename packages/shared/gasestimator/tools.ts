import { z } from "zod";
import { createTool } from "../client.js";
import { type Address, formatUnits, parseUnits } from "viem";
import { getCryptoPriceTool } from "../cryptoprices/tools.js";

export const estimateGasCostTool = createTool({
  name: "estimateGasCost",
  description: "Estimate the gas cost for a transaction in both native token and USD",
  parameters: z.object({
    chainId: z.number().describe("Chain ID (e.g. 1 for Ethereum, 137 for Polygon)"),
    gasUnits: z.number().describe("Estimated gas units for the transaction"),
    maxFeePerGas: z.string().optional().describe("Optional max fee per gas in gwei"),
    maxPriorityFeePerGas: z.string().optional().describe("Optional max priority fee per gas in gwei")
  }),
  execute: async (client, args) => {
    const { chainId, gasUnits, maxFeePerGas, maxPriorityFeePerGas } = args;
    
    // Get the public client for the specified chain
    const publicClient = client.getPublicClient(chainId);
    if (!publicClient) {
      throw new Error(`No public client available for chain ID ${chainId}`);
    }

    try {
      // Get latest gas prices if not provided
      let feeData;
      if (!maxFeePerGas || !maxPriorityFeePerGas) {
        try {
          feeData = await publicClient.estimateFeesPerGas();
        } catch (error) {
          // Fallback for chains that don't support EIP-1559
          const gasPrice = await publicClient.getGasPrice();
          feeData = {
            maxFeePerGas: gasPrice,
            maxPriorityFeePerGas: BigInt(0)
          };
        }
      }

      // Use provided values or defaults
      const finalMaxFeePerGas = maxFeePerGas 
        ? parseUnits(maxFeePerGas, 9) 
        : feeData?.maxFeePerGas ?? BigInt(0);
      
      const finalMaxPriorityFeePerGas = maxPriorityFeePerGas 
        ? parseUnits(maxPriorityFeePerGas, 9) 
        : feeData?.maxPriorityFeePerGas ?? BigInt(0);

      // gas units × price per unit. finalMaxFeePerGas is already this chain's
      // live fee, so "L2s are ~10x cheaper" is baked into it; the hard-coded
      // per-chain divisor that used to be applied here discounted it a second
      // time and understated Polygon by 100x.
      const totalGasCost = BigInt(gasUnits) * finalMaxFeePerGas;
      
      // Get the chain's native token symbol
      const nativeSymbol = getNativeTokenSymbol(chainId);
      
      // Format gas prices to gwei for readability
      const formattedMaxFeePerGas = formatUnits(finalMaxFeePerGas, 9);
      const formattedMaxPriorityFeePerGas = formatUnits(finalMaxPriorityFeePerGas, 9);
      
      // Format total cost to ether units
      const formattedTotalCost = formatUnits(totalGasCost, 18);
      
      // Try to get USD price
      let usdPrice: number | null = null;
      let usdCost: number | null = null;
      
      try {
        // Try to use getCryptoPrice tool if available
        const priceResponse = await getCryptoPriceTool.execute(client, { 
          symbol: nativeSymbol 
        });
        
        if (priceResponse && priceResponse.price) {
          usdPrice = priceResponse.price;
          if (usdPrice) usdCost = parseFloat(formattedTotalCost) * usdPrice;
          else {
            throw new Error("Price data not found");
          }
        }
      } catch (error) {
        // Silently fail if price lookup doesn't work
      }
      
      return {
        chainId,
        gasUnits,
        maxFeePerGas: formattedMaxFeePerGas,
        maxPriorityFeePerGas: formattedMaxPriorityFeePerGas,
        totalCost: formattedTotalCost,
        nativeSymbol,
        usdPrice: usdPrice,
        usdCost: usdCost !== null ? usdCost.toFixed(2) : null,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Error estimating gas cost: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
});

// Helper function to get native token symbol based on chain ID
function getNativeTokenSymbol(chainId: number): string {
  const symbols: Record<number, string> = {
    1: "ETH",      // Ethereum Mainnet
    10: "ETH",     // Optimism
    42161: "ETH",  // Arbitrum
    137: "MATIC",  // Polygon
    56: "BNB",     // BNB Chain
    43114: "AVAX", // Avalanche
    8453: "ETH",   // Base
    324: "ETH",    // zkSync Era
    100: "XDAI",   // Gnosis Chain
    42220: "CELO", // Celo
    250: "FTM",    // Fantom
    1101: "ETH",   // Polygon zkEVM
    5: "ETH",      // Goerli testnet
    11155111: "ETH" // Sepolia testnet
  };
  
  return symbols[chainId] || "ETH"; // Default to ETH if chain ID not recognized
}
