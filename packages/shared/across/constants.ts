import { mainnet, polygon, arbitrum, optimism, base } from "viem/chains";

export const acrossSpokePoolAbi = [
  {
    inputs: [
      { internalType: "address", name: "depositor", type: "address" },
      { internalType: "address", name: "recipient", type: "address" },
      { internalType: "address", name: "inputToken", type: "address" },
      { internalType: "address", name: "outputToken", type: "address" },
      { internalType: "uint256", name: "inputAmount", type: "uint256" },
      { internalType: "uint256", name: "outputAmount", type: "uint256" },
      { internalType: "uint256", name: "destinationChainId", type: "uint256" },
      { internalType: "address", name: "exclusiveRelayer", type: "address" },
      { internalType: "uint32", name: "quoteTimestamp", type: "uint32" },
      { internalType: "uint32", name: "fillDeadline", type: "uint32" },
      { internalType: "uint32", name: "exclusivityParameter", type: "uint32" },
      { internalType: "bytes", name: "message", type: "bytes" },
    ],
    name: "depositV3",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
] as const;

export const ACROSS_SPOKE_POOL_ADDRESS: Record<number, string> = {
  // Official Across deployment registry + Robinhood RPC code verified 2026-09-11.
  4663: "0xD29C85F15DF544bA632C9E25829fd29d767d7978",
  [mainnet.id]: "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
  [polygon.id]: "0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096",
  [arbitrum.id]: "0xe35e9842fceaca96570b734083f4a58e8f7c5f2a",
  [optimism.id]: "0x6f26Bf09B1C792e3228e5467807a900A503c0281",
  [base.id]: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
};
